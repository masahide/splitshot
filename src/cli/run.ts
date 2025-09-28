import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import crypto from "node:crypto";
import { ensureDir, findLatestPlanDir, writeFileUtf8 } from "../core/paths.js";
import { formatCliError } from "../core/errors.js";
import { JsonlFollower } from "../core/jsonlFollower.js";
import { createEventsWriter } from "../core/eventsWriter.js";
import { inheritCodexAuthFiles } from "../core/codexAuth.js";
import { detectCodexFeatures } from "../core/codex.js";

type ManifestObjective = {
    sourcePath: string;
    outputFile: string;
};

type Manifest = {
    version: 2;
    objective?: ManifestObjective;
    createdAt: string;
    workers: { id: string; checklist: string }[];
    docsIndex?: string;
};

export function cmdRun() {
    const cmd = new Command("run");
    cmd
        .description("Run Codex in parallel from a plan-dir manifest & checklists")
        .option("--plan-dir <dir>", "plan-dir (default: latest ./.splitshot/plan-*/)")
        .option("--codex-bin <path>", "Codex binary or JS", "codex")
        .option("--max-parallel <n>", "Max concurrent workers (default: #workers)", (v) => parseInt(v, 10), 0)
        .option("--auto-isolate", "Auto-suffix CODEX_HOME conflicts", true)
        .option("--no-auto-isolate", "Disable auto isolate (default: enabled)") // default true when omitted
        .option("--codex-home-template <tpl>", "Template for CODEX_HOME (default: <planDir>/.homes/<workerId>)")
        .action(async (opts) => {
            // 1) plan-dir 解決
            const planDir = path.resolve(
                opts.planDir ?? (findLatestPlanDir(path.resolve(".splitshot")) ?? "")
            );
            if (!planDir || !fs.existsSync(planDir)) {
                console.error("plan-dir not found. Provide --plan-dir or create one via `splitshot plan`.");
                process.exit(1);
                return;
            }
            const manifestPath = path.join(planDir, "manifest.json");
            if (!fs.existsSync(manifestPath)) {
                console.error(`manifest.json not found at ${manifestPath}`);
                process.exit(1);
                return;
            }
            const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            if (!Array.isArray(manifest.workers) || manifest.workers.length === 0) {
                console.error("manifest.workers is empty.");
                process.exit(1);
                return;
            }

            // 2) run ディレクトリ作成
            const runsBase = path.join(planDir, ".runs");
            ensureDir(runsBase);
            const runDir = path.join(runsBase, String(Date.now()));
            ensureDir(runDir);

            // 3) 並列数
            const maxParallel = opts.maxParallel > 0 ? opts.maxParallel : manifest.workers.length;

            // Codex の --json 対応を検出（あるときだけ付ける）
            const feats = await detectCodexFeatures(opts.codexBin);
            const supportsJson = feats.hasJson;

            // 4) CODEX_HOME 準備（衝突検知 & auto-isolate）
            const baseHome = path.join(planDir, ".homes");
            ensureDir(baseHome);
            const tpl: string = (opts.codexHomeTemplate as string | undefined) ?? "<planDir>/.homes/<workerId>";
            const homeMap: Record<string, string> = {};
            const seen = new Map<string, string>(); // home -> workerId
            for (const w of manifest.workers) {
                let home = tpl
                    .replaceAll("<planDir>", planDir)
                    .replaceAll("<workerId>", w.id);
                if (seen.has(home)) {
                    // commander の --no-auto-isolate は boolean で false、指定なしは true
                    const autoIsolate = opts.autoIsolate !== false;
                    if (!autoIsolate) {
                        console.error(
                            formatCliError("run",
                                `Duplicate CODEX_HOME detected: ${home}.`,
                                "Enable auto-isolation or change --codex-home-template")
                        );
                        process.exit(1);
                        return;
                    }
                    const short = crypto.randomUUID().slice(0, 6);
                    home = `${home}-iso-${short}`;
                }
                seen.set(home, w.id);
                homeMap[w.id] = home;
                ensureDir(home);
                inheritCodexAuthFiles(home);
            }

            // 5) run.meta.json
            writeFileUtf8(
                path.join(runDir, "run.meta.json"),
                JSON.stringify({ workers: manifest.workers.map((w) => w.id), maxParallel, codexHomes: homeMap }, null, 2)
            );

            // 6) 実行（チェックリストを prompt として渡す）
            const events = createEventsWriter(path.join(runDir, "events.ndjson"));
            const jobs = manifest.workers.map((w) => async () => {
                const checklistAbs = path.join(planDir, w.checklist);
                const prompt = fs.readFileSync(checklistAbs, "utf8");
                const env = {
                    ...process.env,
                    CODEX_HOME: homeMap[w.id],
                    SPLITSHOT_RUN_ID: w.id,
                    SPLITSHOT_CHECKLIST_FILE: checklistAbs,
                };

                // state:start
                events.write({ t: Date.now(), type: "state", runId: w.id, data: { phase: "start" } });

                // JSONL フォロワ開始
                const follower = new JsonlFollower(
                    path.join(homeMap[w.id], "sessions"),
                    (line) => events.write({ t: Date.now(), type: "jsonl", runId: w.id, data: { line } }),
                    200
                );
                follower.start();

                // codex exec [--json?] -- "<prompt>"
                const args = ["exec", ...(supportsJson ? ["--json"] : []), "--", prompt];
                const child = spawn(
                    opts.codexBin.endsWith(".js") ? process.execPath : opts.codexBin,
                    opts.codexBin.endsWith(".js") ? [opts.codexBin, ...args] : args,
                    { cwd: planDir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
                );

                const rl = (s: NodeJS.ReadableStream) =>
                    readline.createInterface({ input: s, crlfDelay: Infinity });
                rl(child.stdout!).on("line", (l) => events.write({ t: Date.now(), type: "stdout", runId: w.id, data: { line: l } }));
                rl(child.stderr!).on("line", (l) => events.write({ t: Date.now(), type: "stderr", runId: w.id, data: { line: l } }));
                const code: number = await new Promise((res) => child.on("close", (c) => res(c ?? 1)));

                await new Promise((r) => setTimeout(r, 200)); // 最終追記の猶予
                follower.stop();

                events.write({ t: Date.now(), type: "state", runId: w.id, data: { phase: "exit", code } });
                return code;
            });

            let anyFailed = false;
            await runWithLimit(maxParallel, jobs, (code) => {
                if (code !== 0) anyFailed = true;
            });
            await events.close();

            // latest.json
            writeFileUtf8(path.join(runsBase, "latest.json"), JSON.stringify({ runDir }, null, 2));
            process.exit(anyFailed ? 1 : 0);
        });
    return cmd;
}


async function runWithLimit(
    n: number,
    jobs: Array<() => Promise<number>>,
    onFinish: (code: number) => void
) {
    let i = 0;
    let active = 0;
    return new Promise<void>((resolve) => {
        const next = () => {
            if (i === jobs.length && active === 0) return resolve();
            while (active < n && i < jobs.length) {
                const job = jobs[i++];
                active++;
                job()
                    .then((code) => onFinish(code))
                    .catch(() => onFinish(1))
                    .finally(() => {
                        active--;
                        next();
                    });
            }
        };
        next();
    });
}
