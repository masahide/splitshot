import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import type { Assignments, Plan } from "../core/types";
import { ensureUniqueCodexHomes, DuplicateCodexHomeError, runAll } from "../core/runner.js";

function readJson<T>(p: string): T {
    return JSON.parse(fs.readFileSync(path.resolve(p), "utf8")) as T;
}

export function cmdRun() {
    const cmd = new Command("run");
    cmd
        .description("Execute plan tasks with scheduling and tailing Codex outputs")
        .option("--plan <file>", "Plan JSON file")
        .option("--assignments <file>", "Assignments JSON file")
        .option("--max-parallel <n>", "Max parallel tasks", (v) => parseInt(v, 10), 1)
        .option("--codex <path>", "Runner binary or JS stub", "codex-runner")
        .option("--codex-args <args>", "Extra args (space separated)")
        .option("--auto-isolate", "Auto suffix CODEX_HOME conflicts", false)
        .action(async (opts) => {
            if (!opts.plan) throw new Error("--plan is required");
            if (!opts.assignments) throw new Error("--assignments is required");
            const plan = readJson<Plan>(opts.plan);
            const asn = readJson<Assignments>(opts.assignments);
            const asnAbs = path.resolve(opts.assignments);
            const outBase = path.dirname(asnAbs); // ← 出力ベースを assignments のディレクトリに

            let { assignments } = asn;
            let mapping: Record<string, string> = {};
            try {
                const resolved = ensureUniqueCodexHomes(assignments, { autoIsolate: !!opts.autoIsolate });
                assignments = resolved.assignments;
                mapping = resolved.mapping;
            } catch (e) {
                if (e instanceof DuplicateCodexHomeError) {
                    console.error(e.message);
                    process.exit(1);
                    return;
                }
                throw e;
            }

            const root = path.join(outBase, ".codex-parallel"); // ← ここを変更
            const runsBase = path.join(root, "runs");
            fs.mkdirSync(runsBase, { recursive: true });
            const ts = Date.now();
            const runDir = path.join(runsBase, String(ts));
            fs.mkdirSync(runDir, { recursive: true });

            // メタ
            fs.writeFileSync(
                path.join(runDir, "run.meta.json"),
                JSON.stringify(
                    { planId: asn.planId ?? null, codexHomes: mapping, maxParallel: opts.maxParallel },
                    null,
                    2
                )
            );

            const codexArgs = typeof opts.codexArgs === "string" ? opts.codexArgs.split(/\s+/).filter(Boolean) : undefined;
            const code = await runAll({
                plan,
                assignments,
                maxParallel: opts.maxParallel,
                codexCmd: opts.codex,
                codexArgs,
                runDir,
            });

            // latest ポインタ
            fs.writeFileSync(path.join(runsBase, "latest.json"), JSON.stringify({ runDir }, null, 2));

            process.exit(code);
        });

    return cmd;
}