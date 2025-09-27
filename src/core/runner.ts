import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import crypto from "node:crypto";
import { buildBatches } from "./scheduler.js";
import type { Assignment, Plan, TaskSpec } from "./types.js";

// ---------- CODEX_HOME 競合検知 ----------
export class DuplicateCodexHomeError extends Error {
  homes: string[];
  constructor(message: string, homes: string[]) {
    super(message);
    this.name = "DuplicateCodexHomeError";
    this.homes = homes;
  }
}

export function ensureUniqueCodexHomes(
  assignments: Assignment[],
  { autoIsolate }: { autoIsolate: boolean }
): { assignments: Assignment[]; mapping: Record<string, string> } {
  const byHome = new Map<string, number[]>();
  assignments.forEach((a, i) => {
    const arr = byHome.get(a.codexHome) ?? [];
    arr.push(i);
    byHome.set(a.codexHome, arr);
  });

  const dups = [...byHome.entries()].filter(([, idxs]) => idxs.length > 1);
  if (dups.length === 0) {
    return {
      assignments: assignments.map((a) => ({ ...a })),
      mapping: Object.fromEntries(assignments.map((a) => [a.taskId, a.codexHome])),
    };
  }
  if (!autoIsolate) {
    const homes = dups.map(([h]) => h);
    throw new DuplicateCodexHomeError(
      `Duplicate CODEX_HOME detected: ${homes.join(
        ", "
      )}. Use --auto-isolate to suffix unique directories.`,
      homes
    );
  }
  const cloned = assignments.map((a) => ({ ...a }));
  for (const [, idxs] of dups) {
    for (let j = 1; j < idxs.length; j++) {
      const i = idxs[j];
      const short = crypto.randomUUID().slice(0, 6);
      cloned[i].codexHome = `${cloned[i].codexHome}-iso-${short}`;
    }
  }
  return {
    assignments: cloned,
    mapping: Object.fromEntries(cloned.map((a) => [a.taskId, a.codexHome])),
  };
}


// ---------- events.ndjson ライター ----------
type StateEventData =
  | { phase: "start" }
  | { phase: "exit"; code: number }
  | { phase: "blocked"; reason: "dependency_failed" | string; deps?: string[] };
type LineEventData = { line: string };
type StateEvent = { t: number; type: "state"; runId: string; data: StateEventData };
type LineEvent = {
  t: number;
  type: "stdout" | "stderr" | "jsonl";
  runId: string;
  data: LineEventData;
};
type EventRecord = StateEvent | LineEvent;

function createEventsWriter(filepath: string) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const ws = fs.createWriteStream(filepath, { flags: "a" });
  let queued = 0;
  return {
    write(obj: EventRecord) {
      // 行バッファ詰まり対策で軽くcork/uncork
      if (++queued % 200 === 0) ws.cork();
      ws.write(JSON.stringify(obj) + "\n");
      if (queued % 200 === 0) process.nextTick(() => ws.uncork());
    },
    async close() {
      await new Promise<void>((r) => ws.end(r));
    },
  };
}

// ---------- rollout-*.jsonl フォロワ ----------
class JsonlFollower {
  private timer?: NodeJS.Timeout;
  private positions = new Map<string, number>();
  private stopped = false;
  constructor(
    private sessionsDir: string,
    private onLine: (line: string) => void,
    private intervalMs = 200
  ) { }

  start() {
    const tick = () => {
      if (this.stopped) return;
      try {
        if (fs.existsSync(this.sessionsDir)) {
          const stack = this.listJsonl(this.sessionsDir);
          for (const fp of stack) this.drain(fp);
        }
      } catch {
        // noop
      }
      this.timer = setTimeout(tick, this.intervalMs);
    };
    tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private listJsonl(dir: string): string[] {
    const out: string[] = [];
    for (const ent of safeReaddir(dir)) {
      const p = path.join(dir, ent);
      const st = safeStat(p);
      if (st?.isDirectory()) out.push(...this.listJsonl(p));
      else if (/rollout-.*\.jsonl$/.test(ent)) out.push(p);
    }
    return out.sort();
  }

  private drain(fp: string) {
    const pos = this.positions.get(fp) ?? 0;
    const st = safeStat(fp);
    if (!st) return;
    if (st.size < pos) {
      // ローテーション/truncate
      this.positions.set(fp, 0);
      return;
    }
    if (st.size === pos) return;
    const fd = fs.openSync(fp, "r");
    try {
      const len = st.size - pos;
      const buf = Buffer.allocUnsafe(len);
      fs.readSync(fd, buf, 0, len, pos);
      this.positions.set(fp, st.size);
      const text = buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        this.onLine(line);
      }
    } finally {
      fs.closeSync(fd);
    }
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
function safeStat(p: string) {
  try {
    return fs.statSync(p);
  } catch {
    return undefined;
  }
}

// ---------- ランナ本体 ----------
type RunAllOpts = {
  plan: Plan;
  assignments: Assignment[];
  maxParallel: number;
  codexCmd?: string;
  codexArgs?: string[];
  runDir: string;
};

export async function runAll(opts: RunAllOpts): Promise<number> {
  const { plan, runDir } = opts;
  const events = createEventsWriter(path.join(runDir, "events.ndjson"));
  const batches = buildBatches(plan.tasks);
  const asnById = new Map<string, Assignment>(
    opts.assignments.map((a) => [a.taskId, a])
  );
  const status = new Map<string, "pending" | "running" | "success" | "failed" | "blocked">();
  plan.tasks.forEach((t) => status.set(t.id, "pending"));

  let anyFailed = false;

  for (const layer of batches) {
    const runnable: TaskSpec[] = [];
    for (const t of layer) {
      const deps = t.dependsOn ?? [];
      const failedDeps = deps.filter((d) => status.get(d) === "failed");
      if (failedDeps.length > 0) {
        status.set(t.id, "blocked");
        events.write({
          t: Date.now(),
          type: "state",
          runId: t.id,
          data: { phase: "blocked", reason: "dependency_failed", deps: failedDeps },
        });
      } else {
        runnable.push(t);
      }
    }

    await runWithLimit(
      opts.maxParallel,
      runnable.map((t) => async () => {
        const a = asnById.get(t.id)!;
        // 必要なディレクトリを事前に作成
        fs.mkdirSync(a.worktreeDir, { recursive: true });
        fs.mkdirSync(a.codexHome, { recursive: true });
        status.set(t.id, "running");
        events.write({ t: Date.now(), type: "state", runId: t.id, data: { phase: "start" } });

        // rollout フォロー開始
        const follower = new JsonlFollower(
          path.join(a.codexHome, "sessions"),
          (line) => events.write({ t: Date.now(), type: "jsonl", runId: t.id, data: { line } })
        );
        follower.start();

        const code = await spawnCodex(t.id, a, opts.codexCmd, opts.codexArgs, runDir, (kind, line) =>
          events.write({ t: Date.now(), type: kind, runId: t.id, data: { line } })
        );

        // 少し待ってから follower 停止（最後の追記を拾う）
        await new Promise((r) => setTimeout(r, 200));
        follower.stop();

        events.write({
          t: Date.now(),
          type: "state",
          runId: t.id,
          data: { phase: "exit", code },
        });

        if (code === 0) status.set(t.id, "success");
        else {
          status.set(t.id, "failed");
          anyFailed = true;
        }
      })
    );
  }

  await events.close();
  return anyFailed ? 1 : 0;
}

async function runWithLimit(n: number, jobs: Array<() => Promise<void>>) {
  let i = 0;
  let active = 0;
  return new Promise<void>((resolve) => {
    const next = () => {
      if (i === jobs.length && active === 0) return resolve();
      while (active < n && i < jobs.length) {
        const job = jobs[i++];
        active++;
        job()
          .catch(() => {
            // 個別のエラーは呼び出し側で状態管理済み
          })
          .finally(() => {
            active--;
            next();
          });
      }
    };
    next();
  });
}

function buildSpawnArgs(codexCmd?: string, codexArgs?: string[]) {
  const cmd = codexCmd ?? "codex";
  const args = codexArgs ?? [];
  const isJs = cmd.endsWith(".js");
  if (isJs) {
    return { command: process.execPath, args: [cmd, ...args] };
  }
  return { command: cmd, args };
}

async function spawnCodex(
  runId: string,
  a: Assignment,
  codexCmd: string | undefined,
  codexArgs: string[] | undefined,
  runDir: string,
  onLine: (kind: "stdout" | "stderr", line: string) => void
): Promise<number> {
  const { command, args } = buildSpawnArgs(codexCmd, codexArgs);
  const env = { ...process.env, CODEX_HOME: path.resolve(a.codexHome), SPLITSHOT_RUN_ID: runId };
  const child = spawn(command, args, {
    cwd: a.worktreeDir || process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const makeRl = (s: NodeJS.ReadableStream) =>
    readline.createInterface({ input: s, crlfDelay: Infinity });

  const outRl = makeRl(child.stdout!);
  const errRl = makeRl(child.stderr!);
  outRl.on("line", (l) => onLine("stdout", l));
  errRl.on("line", (l) => onLine("stderr", l));

  const code = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });
  return code;
}