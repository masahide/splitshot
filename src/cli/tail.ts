import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { findLatestPlanDir } from "../core/paths.js";

type TailOpts = {
    run?: string;               // runId or "all"
    type?: string;              // csv: stdout,stderr,jsonl,state
    events?: string;            // (test用) events.ndjson を直接指定
    duration?: number;          // フォロー時間(ms)。未指定なら非フォローで即終了
    interval?: number;          // ポーリング間隔(ms)
    planDir?: string;           // どの plan-dir の latest を参照するか（省略時は最新の plan-dir）
};

function resolveEventsFile(opts: TailOpts, cwd: string): string {
    if (opts.events) return path.resolve(cwd, opts.events);
    const planDir = path.resolve(opts.planDir ?? (findLatestPlanDir(path.resolve(".splitshot")) ?? cwd));
    const latest = path.join(planDir, ".runs", "latest.json");
    if (!fs.existsSync(latest)) {
        throw new Error(`latest.json not found at ${latest}. Provide --events <file> or --plan-dir <dir>.`);
    }
    const { runDir } = JSON.parse(fs.readFileSync(latest, "utf8"));
    const ev = path.join(runDir, "events.ndjson");
    if (!fs.existsSync(ev)) {
        throw new Error(`events.ndjson not found at ${ev}`);
    }
    return ev;
}

function parseTypes(v?: string): Set<string> | null {
    if (!v) return null;
    const s = new Set<string>();
    for (const t of v.split(",").map((x) => x.trim()).filter(Boolean)) s.add(t);
    return s;
}

function matches(line: string, run: string | undefined, types: Set<string> | null): boolean {
    try {
        const obj = JSON.parse(line);
        if (run && run !== "all" && obj.runId !== run) return false;
        if (types && !types.has(obj.type)) return false;
        return true;
    } catch {
        return false;
    }
}

export async function tailOnce(evFile: string, run: string | undefined, types: Set<string> | null): Promise<string[]> {
    if (!fs.existsSync(evFile)) return [];
    const text = fs.readFileSync(evFile, "utf8");
    const out: string[] = [];
    for (const ln of text.split(/\r?\n/)) {
        if (!ln.trim()) continue;
        if (matches(ln, run, types)) out.push(ln);
    }
    return out;
}

export async function tailFollow(
    evFile: string,
    run: string | undefined,
    types: Set<string> | null,
    durationMs: number,
    intervalMs: number
): Promise<string[]> {
    let pos = 0;
    const lines: string[] = [];
    const start = Date.now();

    // まずは既存分を読む
    if (fs.existsSync(evFile)) {
        const st = fs.statSync(evFile);
        const buf = fs.readFileSync(evFile, "utf8");
        pos = st.size;
        for (const ln of buf.split(/\r?\n/)) {
            if (!ln.trim()) continue;
            if (matches(ln, run, types)) lines.push(ln);
        }
    }

    while (Date.now() - start < durationMs) {
        await new Promise((r) => setTimeout(r, intervalMs));
        if (!fs.existsSync(evFile)) continue;
        const st = fs.statSync(evFile);
        if (st.size <= pos) continue;
        const fd = fs.openSync(evFile, "r");
        try {
            const len = st.size - pos;
            const buf = Buffer.allocUnsafe(len);
            fs.readSync(fd, buf, 0, len, pos);
            pos = st.size;
            const text = buf.toString("utf8");
            for (const ln of text.split(/\r?\n/)) {
                if (!ln.trim()) continue;
                if (matches(ln, run, types)) lines.push(ln);
            }
        } finally {
            fs.closeSync(fd);
        }
    }
    return lines;
}

export function cmdTail() {
    const cmd = new Command("tail");
    cmd
        .description("Follow events.ndjson and filter by run/type")
        .option("--run <id|all>", "Run ID to filter (default: all)", "all")
        .option("--type <csv>", "Filter types: stdout,stderr,jsonl,state")
        // テスト補助: 直接 events.ndjson を指定できるように
        .option("--events <file>", "Path to events.ndjson (otherwise uses ./.codex-parallel/runs/latest.json)")
        // plan-dir 指定
        .option("--plan-dir <dir>", "Plan directory (default: latest under ./.splitshot)")
        .option("--duration <ms>", "Follow duration milliseconds (if omitted, just prints current contents and exit)", (v) => parseInt(v, 10), undefined)
        .option("--interval <ms>", "Polling interval milliseconds", (v) => parseInt(v, 10), 100)
        .action(async (opts: TailOpts) => {
            const cwd = process.cwd();
            const evFile = resolveEventsFile(opts, cwd);
            const types = parseTypes(opts.type);
            const run = opts.run;

            try {
                let outLines: string[] = [];
                if (typeof opts.duration === "number" && Number.isFinite(opts.duration)) {
                    outLines = await tailFollow(evFile, run, types, opts.duration!, opts.interval ?? 100);
                } else {
                    outLines = await tailOnce(evFile, run, types);
                }
                if (outLines.length) process.stdout.write(outLines.join("\n") + "\n");
                process.exit(0);
            } catch (e) {
                console.error(e instanceof Error ? e.message : String(e));
                process.exit(1);
            }
        });
    return cmd;
}
