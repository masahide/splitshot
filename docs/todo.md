いい流れ！**（私見）**
現時点の進捗と残タスクを最新化しました。上から潰せばMVPが閉じます。

---

# 進捗チェックリスト（最新）

## ✅ 完了

* [x] プロジェクト雛形（Node 18+/ESM, pnpm, tsup）
* [x] Lint（ESLint v9 フラット構成）/ Prettier
* [x] Typecheck（`tsconfig.typecheck.json` / `pnpm typecheck`）
* [x] テスト基盤（Vitest、`pretest -> build`）
* [x] Codexスタブ（`tests/fixtures/codex-stub.js`）
* [x] **plan コマンド**

  * [x] `--output-schema`/`--json` 検出（help強化）
  * [x] `--force-schema`
  * [x] Ajv **2020-12** 検証（`ajv/dist/2020.js`）
  * [x] 生成物保存（`.codex-parallel/plan-*.json`, `plan.prompt-*.txt`）
  * [x] テスト：スタブでPlan JSONを取得
* [x] **assign コマンド（最小）**

  * [x] `--plan` 読み込み、`--map` で worktree に割当
  * [x] `--codex-home-template` 展開
  * [x] 出力：`.codex-parallel/assignments-*.json`
  * [x] テスト：割当/保存を検証
* [x] **scheduler（buildBatches）**

  * [x] 依存DAG→並列バッチ化
  * [x] 循環検出
  * [x] テスト：トポロジー/循環

---

## 🔜 残タスク（MVP必須）

### A. `run` コマンド（コア）
了解！このコードベースから**TODOに沿って実装**を進めました。まずは **A: runコマンド（コア）** を最小構成〜必要十分まで一気に入れて、テストも追加しています。以下のファイルを追加/更新してください（全置換OK）。入れたら `pnpm build && pnpm test` で通る想定です（私見）。

---

```diff
=== BEGIN FILE: src/core/runner.ts ===
+import fs from "node:fs";
+import path from "node:path";
+import os from "node:os";
+import { spawn } from "node:child_process";
+import readline from "node:readline";
+import crypto from "node:crypto";
+import { buildBatches } from "./scheduler.js";
+import type { Assignment, Plan, TaskSpec } from "./types";
+
+// ---------- CODEX_HOME 競合検知 ----------
+export class DuplicateCodexHomeError extends Error {
+  homes: string[];
+  constructor(message: string, homes: string[]) {
+    super(message);
+    this.name = "DuplicateCodexHomeError";
+    this.homes = homes;
+  }
+}
+
+export function ensureUniqueCodexHomes(
+  assignments: Assignment[],
+  { autoIsolate }: { autoIsolate: boolean }
+): { assignments: Assignment[]; mapping: Record<string, string> } {
+  const byHome = new Map<string, number[]>();
+  assignments.forEach((a, i) => {
+    const arr = byHome.get(a.codexHome) ?? [];
+    arr.push(i);
+    byHome.set(a.codexHome, arr);
+  });
+
+  const dups = [...byHome.entries()].filter(([, idxs]) => idxs.length > 1);
+  if (dups.length === 0) {
+    return {
+      assignments: assignments.map((a) => ({ ...a })),
+      mapping: Object.fromEntries(assignments.map((a) => [a.taskId, a.codexHome])),
+    };
+  }
+  if (!autoIsolate) {
+    const homes = dups.map(([h]) => h);
+    throw new DuplicateCodexHomeError(
+      `Duplicate CODEX_HOME detected: ${homes.join(
+        ", "
+      )}. Use --auto-isolate to suffix unique directories.`,
+      homes
+    );
+  }
+  const cloned = assignments.map((a) => ({ ...a }));
+  for (const [, idxs] of dups) {
+    for (let j = 1; j < idxs.length; j++) {
+      const i = idxs[j];
+      const short = crypto.randomUUID().slice(0, 6);
+      cloned[i].codexHome = `${cloned[i].codexHome}-iso-${short}`;
+    }
+  }
+  return {
+    assignments: cloned,
+    mapping: Object.fromEntries(cloned.map((a) => [a.taskId, a.codexHome])),
+  };
+}
+
+// ---------- events.ndjson ライター ----------
+type EventRecord = {
+  t: number;
+  type: "state" | "stdout" | "stderr" | "jsonl";
+  runId: string;
+  data: any;
+};
+
+function createEventsWriter(filepath: string) {
+  fs.mkdirSync(path.dirname(filepath), { recursive: true });
+  const ws = fs.createWriteStream(filepath, { flags: "a" });
+  let queued = 0;
+  return {
+    write(obj: EventRecord) {
+      // 行バッファ詰まり対策で軽くcork/uncork
+      if (++queued % 200 === 0) ws.cork();
+      ws.write(JSON.stringify(obj) + "\n");
+      if (queued % 200 === 0) process.nextTick(() => ws.uncork());
+    },
+    async close() {
+      await new Promise<void>((r) => ws.end(r));
+    },
+  };
+}
+
+// ---------- rollout-*.jsonl フォロワ ----------
+class JsonlFollower {
+  private timer?: NodeJS.Timeout;
+  private positions = new Map<string, number>();
+  private stopped = false;
+  constructor(
+    private sessionsDir: string,
+    private onLine: (line: string) => void,
+    private intervalMs = 200
+  ) {}
+
+  start() {
+    const tick = () => {
+      if (this.stopped) return;
+      try {
+        if (fs.existsSync(this.sessionsDir)) {
+          const stack = this.listJsonl(this.sessionsDir);
+          for (const fp of stack) this.drain(fp);
+        }
+      } catch {
+        // noop
+      }
+      this.timer = setTimeout(tick, this.intervalMs);
+    };
+    tick();
+  }
+
+  stop() {
+    this.stopped = true;
+    if (this.timer) clearTimeout(this.timer);
+  }
+
+  private listJsonl(dir: string): string[] {
+    const out: string[] = [];
+    for (const ent of safeReaddir(dir)) {
+      const p = path.join(dir, ent);
+      const st = safeStat(p);
+      if (st?.isDirectory()) out.push(...this.listJsonl(p));
+      else if (/rollout-.*\.jsonl$/.test(ent)) out.push(p);
+    }
+    return out.sort();
+  }
+
+  private drain(fp: string) {
+    const pos = this.positions.get(fp) ?? 0;
+    const st = safeStat(fp);
+    if (!st) return;
+    if (st.size < pos) {
+      // ローテーション/truncate
+      this.positions.set(fp, 0);
+      return;
+    }
+    if (st.size === pos) return;
+    const fd = fs.openSync(fp, "r");
+    try {
+      const len = st.size - pos;
+      const buf = Buffer.allocUnsafe(len);
+      fs.readSync(fd, buf, 0, len, pos);
+      this.positions.set(fp, st.size);
+      const text = buf.toString("utf8");
+      for (const line of text.split(/\r?\n/)) {
+        if (!line.trim()) continue;
+        this.onLine(line);
+      }
+    } finally {
+      fs.closeSync(fd);
+    }
+  }
+}
+
+function safeReaddir(dir: string): string[] {
+  try {
+    return fs.readdirSync(dir);
+  } catch {
+    return [];
+  }
+}
+function safeStat(p: string) {
+  try {
+    return fs.statSync(p);
+  } catch {
+    return undefined;
+  }
+}
+
+// ---------- ランナ本体 ----------
+type RunAllOpts = {
+  plan: Plan;
+  assignments: Assignment[];
+  maxParallel: number;
+  codexCmd?: string;
+  codexArgs?: string[];
+  runDir: string;
+};
+
+export async function runAll(opts: RunAllOpts): Promise<number> {
+  const { plan, runDir } = opts;
+  const events = createEventsWriter(path.join(runDir, "events.ndjson"));
+  const batches = buildBatches(plan.tasks);
+  const byId = new Map<string, TaskSpec>(plan.tasks.map((t) => [t.id, t]));
+  const asnById = new Map<string, Assignment>(
+    opts.assignments.map((a) => [a.taskId, a])
+  );
+  const status = new Map<string, "pending" | "running" | "success" | "failed" | "blocked">();
+  plan.tasks.forEach((t) => status.set(t.id, "pending"));
+
+  let anyFailed = false;
+
+  for (const layer of batches) {
+    const runnable: TaskSpec[] = [];
+    for (const t of layer) {
+      const deps = t.dependsOn ?? [];
+      const failedDeps = deps.filter((d) => status.get(d) === "failed");
+      if (failedDeps.length > 0) {
+        status.set(t.id, "blocked");
+        events.write({
+          t: Date.now(),
+          type: "state",
+          runId: t.id,
+          data: { phase: "blocked", reason: "dependency_failed", deps: failedDeps },
+        });
+      } else {
+        runnable.push(t);
+      }
+    }
+
+    await runWithLimit(
+      opts.maxParallel,
+      runnable.map((t) => async () => {
+        const a = asnById.get(t.id)!;
+        fs.mkdirSync(a.codexHome, { recursive: true });
+        status.set(t.id, "running");
+        events.write({ t: Date.now(), type: "state", runId: t.id, data: { phase: "start" } });
+
+        // rollout フォロー開始
+        const follower = new JsonlFollower(
+          path.join(a.codexHome, "sessions"),
+          (line) => events.write({ t: Date.now(), type: "jsonl", runId: t.id, data: { line } })
+        );
+        follower.start();
+
+        const code = await spawnCodex(t.id, a, opts.codexCmd, opts.codexArgs, runDir, (kind, line) =>
+          events.write({ t: Date.now(), type: kind, runId: t.id, data: { line } })
+        );
+
+        // 少し待ってから follower 停止（最後の追記を拾う）
+        await new Promise((r) => setTimeout(r, 200));
+        follower.stop();
+
+        events.write({
+          t: Date.now(),
+          type: "state",
+          runId: t.id,
+          data: { phase: "exit", code },
+        });
+
+        if (code === 0) status.set(t.id, "success");
+        else {
+          status.set(t.id, "failed");
+          anyFailed = true;
+        }
+      })
+    );
+  }
+
+  await events.close();
+  return anyFailed ? 1 : 0;
+}
+
+async function runWithLimit(n: number, jobs: Array<() => Promise<void>>) {
+  const q = jobs.slice();
+  let running: Promise<void>[] = [];
+  const kick = () => {
+    while (running.length < n && q.length) running.push(q.shift()!().finally(() => {
+      running = running.filter((p) => p !== pr);
+    }));
+    const pr = Promise.race(running);
+    return pr;
+  };
+  while (running.length < n && q.length) {
+    running.push(q.shift()!().finally(() => {
+      running = running.filter((p) => p !== pr);
+    }));
+    var pr = Promise.resolve(); // eslint-disable-line
+  }
+  while (running.length || q.length) await kick();
+}
+
+function buildSpawnArgs(codexCmd?: string, codexArgs?: string[]) {
+  const cmd = codexCmd ?? "codex";
+  const args = codexArgs ?? [];
+  const isJs = cmd.endsWith(".js");
+  if (isJs) {
+    return { command: process.execPath, args: [cmd, ...args] };
+  }
+  return { command: cmd, args };
+}
+
+async function spawnCodex(
+  runId: string,
+  a: Assignment,
+  codexCmd: string | undefined,
+  codexArgs: string[] | undefined,
+  runDir: string,
+  onLine: (kind: "stdout" | "stderr", line: string) => void
+): Promise<number> {
+  const { command, args } = buildSpawnArgs(codexCmd, codexArgs);
+  const env = { ...process.env, CODEX_HOME: path.resolve(a.codexHome), SPLITSHOT_RUN_ID: runId };
+  const child = spawn(command, args, {
+    cwd: a.worktreeDir || process.cwd(),
+    env,
+    stdio: ["ignore", "pipe", "pipe"],
+    windowsHide: true,
+  });
+
+  const makeRl = (s: NodeJS.ReadableStream) =>
+    readline.createInterface({ input: s, crlfDelay: Infinity });
+
+  const outRl = makeRl(child.stdout!);
+  const errRl = makeRl(child.stderr!);
+  outRl.on("line", (l) => onLine("stdout", l));
+  errRl.on("line", (l) => onLine("stderr", l));
+
+  const code = await new Promise<number>((resolve) => {
+    child.on("close", (code) => resolve(code ?? 1));
+  });
+  return code;
+}
=== END FILE: src/core/runner.ts ===
```

```diff
=== BEGIN FILE: src/cli/run.ts ===
+import { Command } from "commander";
+import fs from "node:fs";
+import path from "node:path";
+import type { Assignments, Plan } from "../core/types";
+import { ensureUniqueCodexHomes, DuplicateCodexHomeError, runAll } from "../core/runner.js";
+
+function readJson<T>(p: string): T {
+  return JSON.parse(fs.readFileSync(path.resolve(p), "utf8")) as T;
+}
+
+export function cmdRun() {
+  const cmd = new Command("run");
+  cmd
+    .description("Execute plan tasks with scheduling and tailing Codex outputs")
+    .option("--plan <file>", "Plan JSON file")
+    .option("--assignments <file>", "Assignments JSON file")
+    .option("--max-parallel <n>", "Max parallel tasks", (v) => parseInt(v, 10), 1)
+    .option("--codex <path>", "Runner binary or JS stub", "codex-runner")
+    .option("--codex-args <args>", "Extra args (space separated)")
+    .option("--auto-isolate", "Auto suffix CODEX_HOME conflicts", false)
+    .action(async (opts) => {
+      if (!opts.plan) throw new Error("--plan is required");
+      if (!opts.assignments) throw new Error("--assignments is required");
+      const plan = readJson<Plan>(opts.plan);
+      const asn = readJson<Assignments>(opts.assignments);
+
+      let { assignments } = asn;
+      let mapping: Record<string, string> = {};
+      try {
+        const resolved = ensureUniqueCodexHomes(assignments, { autoIsolate: !!opts.autoIsolate });
+        assignments = resolved.assignments;
+        mapping = resolved.mapping;
+      } catch (e) {
+        if (e instanceof DuplicateCodexHomeError) {
+          console.error(e.message);
+          process.exit(1);
+          return;
+        }
+        throw e;
+      }
+
+      const root = path.resolve(".codex-parallel");
+      const runsBase = path.join(root, "runs");
+      fs.mkdirSync(runsBase, { recursive: true });
+      const ts = Date.now();
+      const runDir = path.join(runsBase, String(ts));
+      fs.mkdirSync(runDir, { recursive: true });
+
+      // メタ
+      fs.writeFileSync(
+        path.join(runDir, "run.meta.json"),
+        JSON.stringify(
+          { planId: asn.planId ?? null, codexHomes: mapping, maxParallel: opts.maxParallel },
+          null,
+          2
+        )
+      );
+
+      const codexArgs = typeof opts.codexArgs === "string" ? opts.codexArgs.split(/\s+/).filter(Boolean) : undefined;
+      const code = await runAll({
+        plan,
+        assignments,
+        maxParallel: opts.maxParallel,
+        codexCmd: opts.codex,
+        codexArgs,
+        runDir,
+      });
+
+      // latest ポインタ
+      fs.writeFileSync(path.join(runsBase, "latest.json"), JSON.stringify({ runDir }, null, 2));
+
+      process.exit(code);
+    });
+
+  return cmd;
+}
=== END FILE: src/cli/run.ts ===
```

```diff
=== BEGIN FILE: src/cli/index.ts ===
 import { Command } from "commander";
 import { version, description, name } from "../../package.json";
 import { cmdPlan } from "./plan.js";
 import { cmdAssign } from "./assign.js";   // ← 追加
+import { cmdRun } from "./run.js";
 
 
 const program = new Command();
 
 program
     .name(name || "splitshot")
     .description(description || "Parallel Codex planner & runner (CLI MVP)")
     .version(version);
 
 program.addCommand(cmdPlan());
 program.addCommand(cmdAssign());
+program.addCommand(cmdRun());
 
 program.parseAsync().catch((err) => {
     console.error(err instanceof Error ? err.message : String(err));
     process.exit(1);
 });
 
=== END FILE: src/cli/index.ts ===
```

```diff
=== BEGIN FILE: tests/fixtures/codex-runner-stub.js ===
+#!/usr/bin/env node
+// ランナー用スタブ：stdout/stderrを出し、CODEX_HOME/sessions に rollout-*.jsonl を生成
+import fs from "node:fs";
+import path from "node:path";
+
+const runId = process.env.SPLITSHOT_RUN_ID || "unknown";
+const home = process.env.CODEX_HOME || process.cwd();
+const force = (process.env.SPLITSHOT_FORCE_FAIL_TASK_IDS || "")
+  .split(",")
+  .map((s) => s.trim())
+  .filter(Boolean);
+
+function sleep(ms) {
+  return new Promise((r) => setTimeout(r, ms));
+}
+
+async function main() {
+  process.stdout.write(`[${runId}] hello from stdout 1\n`);
+  process.stderr.write(`[${runId}] warn from stderr 1\n`);
+
+  const sess = path.join(home, "sessions", `s-${Date.now()}`);
+  fs.mkdirSync(sess, { recursive: true });
+  const f1 = path.join(sess, "rollout-1.jsonl");
+  fs.writeFileSync(f1, JSON.stringify({ runId, step: 1, msg: "start" }) + "\n");
+
+  await sleep(30);
+  fs.appendFileSync(f1, JSON.stringify({ runId, step: 2, msg: "mid" }) + "\n");
+  process.stdout.write(`[${runId}] hello from stdout 2\n`);
+
+  // 新しいファイルが「後から」現れるケース
+  await sleep(30);
+  const f2 = path.join(sess, "rollout-2.jsonl");
+  fs.writeFileSync(f2, JSON.stringify({ runId, step: 3, msg: "new-file" }) + "\n");
+  process.stderr.write(`[${runId}] warn from stderr 2\n`);
+
+  if (force.includes(runId)) {
+    process.stderr.write(`[${runId}] forced failure\n`);
+    process.exit(1);
+    return;
+  }
+  process.exit(0);
+}
+
+await main();
=== END FILE: tests/fixtures/codex-runner-stub.js ===
```

```diff
=== BEGIN FILE: tests/run.e2e.test.ts ===
+import { describe, it, expect } from "vitest";
+import { spawnSync } from "node:child_process";
+import fs from "node:fs";
+import path from "node:path";
+import { tmpdir } from "node:os";
+
+const root = process.cwd();
+const cli = path.resolve("dist/cli/index.js");
+const plan = path.resolve("tests/fixtures/plan-min.json");
+const stub = path.resolve("tests/fixtures/codex-runner-stub.js");
+
+function mkTmp(prefix: string) {
+  const p = fs.mkdtempSync(path.join(tmpdir(), prefix));
+  return p;
+}
+function readLines(p: string) {
+  return fs.readFileSync(p, "utf8").trim().split(/\r?\n/).filter(Boolean);
+}
+
+describe("run (E2E): dependsOn + maxParallel=1", () => {
+  it("respects dependsOn order and emits events.ndjson", () => {
+    const work = mkTmp("splitshot-e2e-");
+    const asn = {
+      assignments: [
+        { taskId: "t1", worktreeDir: path.join(work, "wt1"), codexHome: path.join(work, ".home-t1") },
+        { taskId: "t2", worktreeDir: path.join(work, "wt2"), codexHome: path.join(work, ".home-t2") },
+      ],
+    };
+    const asnFile = path.join(work, "assignments.json");
+    fs.writeFileSync(asnFile, JSON.stringify(asn, null, 2));
+
+    const out = spawnSync(process.execPath, [
+      cli,
+      "run",
+      "--plan",
+      plan,
+      "--assignments",
+      asnFile,
+      "--codex",
+      stub,
+      "--max-parallel",
+      "1",
+    ], { cwd: root });
+
+    expect(out.status, String(out.stderr)).toBe(0);
+
+    const latest = JSON.parse(
+      fs.readFileSync(path.join(work, ".codex-parallel", "runs", "latest.json"), "utf8")
+    );
+    const ev = readLines(path.join(latest.runDir, "events.ndjson")).map((l) => JSON.parse(l));
+
+    const starts = ev.filter((e) => e.type === "state" && e.data?.phase === "start").map((e) => e.runId);
+    // t1 が先、t2 が後
+    expect(starts[0]).toBe("t1");
+    expect(starts[1]).toBe("t2");
+  });
+});
=== END FILE: tests/run.e2e.test.ts ===
```

```diff
=== BEGIN FILE: tests/run.auto-isolate.e2e.test.ts ===
+import { describe, it, expect } from "vitest";
+import { spawnSync } from "node:child_process";
+import fs from "node:fs";
+import path from "node:path";
+import { tmpdir } from "node:os";
+
+const root = process.cwd();
+const cli = path.resolve("dist/cli/index.js");
+const plan = path.resolve("tests/fixtures/plan-min.json");
+const stub = path.resolve("tests/fixtures/codex-runner-stub.js");
+
+function mkTmp(prefix: string) {
+  return fs.mkdtempSync(path.join(tmpdir(), prefix));
+}
+function readLines(p: string) {
+  return fs.readFileSync(p, "utf8").trim().split(/\r?\n/).filter(Boolean);
+}
+
+describe("run: CODEX_HOME conflicts", () => {
+  it("fails without --auto-isolate", () => {
+    const work = mkTmp("splitshot-conf-");
+    const shared = path.join(work, ".home-shared");
+    const asn = {
+      assignments: [
+        { taskId: "t1", worktreeDir: path.join(work, "wt1"), codexHome: shared },
+        { taskId: "t2", worktreeDir: path.join(work, "wt2"), codexHome: shared },
+      ],
+    };
+    const asnFile = path.join(work, "assign.json");
+    fs.writeFileSync(asnFile, JSON.stringify(asn, null, 2));
+
+    const out = spawnSync(process.execPath, [
+      cli,
+      "run",
+      "--plan",
+      plan,
+      "--assignments",
+      asnFile,
+      "--codex",
+      stub,
+      "--max-parallel",
+      "2",
+    ], { cwd: root });
+
+    expect(out.status).not.toBe(0);
+    const err = (out.stderr || Buffer.alloc(0)).toString();
+    expect(err).toMatch(/Duplicate CODEX_HOME/i);
+  });
+
+  it("succeeds with --auto-isolate and both tasks start", () => {
+    const work = mkTmp("splitshot-auto-");
+    const shared = path.join(work, ".home-shared");
+    const asn = {
+      assignments: [
+        { taskId: "t1", worktreeDir: path.join(work, "wt1"), codexHome: shared },
+        { taskId: "t2", worktreeDir: path.join(work, "wt2"), codexHome: shared },
+      ],
+    };
+    const asnFile = path.join(work, "assign.json");
+    fs.writeFileSync(asnFile, JSON.stringify(asn, null, 2));
+
+    const out = spawnSync(process.execPath, [
+      cli,
+      "run",
+      "--plan",
+      plan,
+      "--assignments",
+      asnFile,
+      "--codex",
+      stub,
+      "--max-parallel",
+      "2",
+      "--auto-isolate",
+    ], { cwd: root });
+
+    expect(out.status, String(out.stderr)).toBe(0);
+
+    const latest = JSON.parse(fs.readFileSync(path.join(work, ".codex-parallel", "runs", "latest.json"), "utf8"));
+    const lines = readLines(path.join(latest.runDir, "events.ndjson"));
+    const starts = lines.map((l) => JSON.parse(l)).filter((e) => e.type === "state" && e.data?.phase === "start").map((e) => e.runId);
+    expect(new Set(starts)).toEqual(new Set(["t1", "t2"]));
+  });
+});
=== END FILE: tests/run.auto-isolate.e2e.test.ts ===
```

```diff
=== BEGIN FILE: tests/run.propagation.e2e.test.ts ===
+import { describe, it, expect } from "vitest";
+import { spawnSync } from "node:child_process";
+import fs from "node:fs";
+import path from "node:path";
+import { tmpdir } from "node:os";
+
+const root = process.cwd();
+const cli = path.resolve("dist/cli/index.js");
+const plan = path.resolve("tests/fixtures/plan-min.json");
+const stub = path.resolve("tests/fixtures/codex-runner-stub.js");
+
+function mkTmp(prefix: string) {
+  return fs.mkdtempSync(path.join(tmpdir(), prefix));
+}
+function readLines(p: string) {
+  return fs.readFileSync(p, "utf8").trim().split(/\r?\n/).filter(Boolean);
+}
+
+describe("run: failure propagation", () => {
+  it("marks dependent tasks as blocked and exits non-zero", () => {
+    const work = mkTmp("splitshot-prop-");
+    const asn = {
+      assignments: [
+        { taskId: "t1", worktreeDir: path.join(work, "wt1"), codexHome: path.join(work, ".home-t1") },
+        { taskId: "t2", worktreeDir: path.join(work, "wt2"), codexHome: path.join(work, ".home-t2") }, // dependsOn: t1 (plan-min側)
+      ],
+    };
+    const asnFile = path.join(work, "assign.json");
+    fs.writeFileSync(asnFile, JSON.stringify(asn, null, 2));
+
+    const out = spawnSync(process.execPath, [
+      cli,
+      "run",
+      "--plan",
+      plan,
+      "--assignments",
+      asnFile,
+      "--codex",
+      stub,
+      "--max-parallel",
+      "1",
+    ], {
+      cwd: root,
+      env: {
+        ...process.env,
+        SPLITSHOT_FORCE_FAIL_TASK_IDS: "t1",
+      },
+    });
+
+    expect(out.status).not.toBe(0);
+
+    const latest = JSON.parse(fs.readFileSync(path.join(work, ".codex-parallel", "runs", "latest.json"), "utf8"));
+    const evs = readLines(path.join(latest.runDir, "events.ndjson")).map((l) => JSON.parse(l));
+    const starts = evs.filter((e) => e.type === "state" && e.data?.phase === "start").map((e) => e.runId);
+    expect(starts).toContain("t1");
+    expect(starts).not.toContain("t2");
+
+    const blocked = evs.find((e) => e.type === "state" && e.runId === "t2" && e.data?.phase === "blocked");
+    expect(blocked?.data?.reason).toBe("dependency_failed");
+    expect(blocked?.data?.deps).toContain("t1");
+  });
+});
=== END FILE: tests/run.propagation.e2e.test.ts ===
```

---

## ここまでで満たしたTODO

* ✅ `--assignments <file>` 読み込み
* ✅ スケジューリング層実行（`buildBatches`）
* ✅ `--max-parallel` セマフォ（自前 concurrency limiter）
* ✅ プロセス起動（`spawn` / `cwd=worktreeDir` / `env.CODEX_HOME` / `.js`は`process.execPath`経由）
* ✅ `--codex-args` 透過
* ✅ **CODEX_HOME競合検知** / `--auto-isolate`
* ✅ **ログ収集** `stdout` / `stderr` 行単位 → `events.ndjson`
* ✅ **jsonl取り込み**：`$CODEX_HOME/sessions/**/rollout-*.jsonl` を**後出しにも追従**
* ✅ **状態管理**：`start/exit/blocked` イベント、exit code 記録
* ✅ **失敗伝播**：依存失敗 → `blocked`（startしない）
* ✅ **終了コード**：いずれか失敗で非0
* ✅ **テスト**：
  * E2E（依存順＋maxParallel=1、`events.ndjson`生成）
  * `--auto-isolate` の動作（有/無）
  * 失敗伝播（`t1`失敗 → `t2` blocked）
  * ランナースタブで `stdout/stderr/jsonl` 出力（後出しjsonl含む）
* [ ] 大量ログtest（擬似10万行）で欠落なし

> 私見：大量ログ（10万行）テストは本体が安定してから分離テストにした方がよさそう。必要になったら `codex-runner-stub` にループ出力のオプションを足して測定し、`events.ndjson` の行数をチェックするREDを足しましょう。バックプレッシャは簡易cork/uncorkで既に入れてあります。




### B. `tail` コマンド（ミニマム）

* [ ] `events.ndjson` のフォロー（`--run <id|all>` / `--type` フィルタ）
* [ ] 色付け（任意）
* [ ] テスト：フィルタと追尾が効く

### C. `assign` の拡張（仕様にあった分）

* [ ] **自動 worktree 作成**：`--worktree-root` / `--auto-worktree` / `--branch-prefix`
* [ ] `git` 呼び出しヘルパ（`git.ts`）＋スタブテスト

---

## 🧪 品質/DX（MVP同梱したい）

* [ ] `detectCodexFeatures` の単体テスト（help出力スタブ）
* [ ] `schema.ts` エラー系テスト（必須項目欠落）
* [ ] `planner`/`readMaybeFile` の単体テスト
* [ ] `pnpm check` をCI（GitHub Actions）に導入：Linux/Windows × Node 18/20/22
* [ ] README：Quickstart（スタブ/実機Codexの両方）、コマンド例
* [ ] ライセンス、`engines`、`example/`（`objective.md` など）

---

## 🎯 直近の“次の3手”

1. **`run` のRED**：最小E2E（2層＋max-parallel=1）で`events.ndjson`生成を期待 → 失敗させる
2. **Runner/TailerのスタブGREEN**：外部`codex`をまだ呼ばず、擬似プロセスで`events.ndjson`を書かせる
3. **実プロセス差し替え**：`spawn`＋CODEX_HOME設定→`rollout-*.jsonl`取り込み→失敗伝播

---

何か順序を微調整したければ言って。`run` の RED 用テスト雛形もすぐ出せます（私見）。
