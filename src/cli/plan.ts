import { Command } from "commander";
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import { detectCodexFeatures, execCodexWithSchema } from "../core/codex";
import { inheritCodexAuthFiles } from "../core/codexAuth.js";
import { buildPlannerPrompt } from "../core/planner";
import type { Plan } from "../core/types";
import { buildBatches } from "../core/scheduler.js";
import { ensureDir, createPlanDir, writeFileUtf8, isSafeRelativeUnder } from "../core/paths.js";
import { writePlanJsonSchemaFile, parsePlanFromText } from "../schemas/plan.js";
import { detectRepoInfo } from "../core/repo.js";


async function readMaybeFile(v?: string): Promise<string | undefined> {
    if (!v) return;
    const p = path.resolve(String(v));
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return fs.readFileSync(p, "utf8");
    return v;
}

export function cmdPlan() {
    const cmd = new Command("plan");
    cmd
        .description("Generate plan-dir with plan.json, manifest.json and worker checklists")
        .option("--debug", "Enable debug: print/save Codex input and output", false)
        .option("--objective <fileOrText>", "Objective file path or raw text")
        .option("--workers <n>", "Workers hint", (v) => parseInt(v, 10), 3)
        // repo context（自動検出の上書き用・任意）
        .option("--repo-root <dir>", "Repository root override (default: auto-detect)")
        .option("--repo-branch <name>", "Repository branch override (default: auto-detect)")
        .option("--repo-head <sha>", "Repository head SHA override (default: auto-detect)")
        .option("--out <dir>", "Plan base output directory (default: ./.splitshot)")
        .option("--avoid <globs>", "Comma separated globs to avoid (e.g. infra/**,docs/**)")
        .option("--must <globs>", "Comma separated globs to prioritize")
        .option("--approval <mode>", "suggest|auto|full-auto", "suggest")
        .option("--model <name>", "Codex model name")
        .option("--planner-home <dir>", "CODEX_HOME for the planner run")
        .option("--codex-bin <path>", "codex binary path", "codex")
        .option("--timeout <ms>", "execution timeout ms", (v) => parseInt(v, 10), 120000)
        .option(
            "--force-schema",
            "Skip feature detection and use --output-schema directly",
            false
        )
        .action(async (opts) => {
            // 1) Read objective
            const objective = (await readMaybeFile(opts.objective)) ?? "";
            if (!objective.trim()) {
                throw new Error("objective is required (text or file path)");
            }

            // 1.5) Detect repo info (best-effort)
            const autoRepo = await detectRepoInfo(process.cwd());
            const repo = {
                root: opts.repoRoot ?? autoRepo.root,
                branch: opts.repoBranch ?? autoRepo.branch,
                headSha: opts.repoHead ?? autoRepo.headSha,
            };

            // 2) Detect Codex features unless forced
            const feats = await detectCodexFeatures(opts.codexBin);
            if (!opts.forceSchema && !feats.hasOutputSchema) {
                throw new Error(
                    "codex does not support --output-schema (from help parsing). Use --force-schema to skip detection."
                );
            }

            // 2.5) Prepare plan directory ahead of Codex execution so that generated docs land in-place
            const planBase = path.resolve(opts.out ?? ".splitshot");
            ensureDir(planBase);
            const planDir = createPlanDir(planBase);
            ensureDir(path.join(planDir, "checklists"));

            // 3) Zod → JSON Schema を一時ファイルに生成
            const schemaDir = path.resolve(".splitshot/_schemas");
            ensureDir(schemaDir);
            const schemaPath = path.join(schemaDir, "plan.schema.zod.json");
            writePlanJsonSchemaFile(schemaPath);

            // 4) Build prompt for the planner
            const prompt = buildPlannerPrompt({ objective, workers: opts.workers, repo });

            // 5) Run Codex with structured outputs
            if (opts.debug) {
                // print prompt early for visibility
                console.error("[debug] planner prompt:\n" + prompt);
            }
            // planner 用 CODEX_HOME を決定し、認証ファイルを継承
            const plannerHome = opts.plannerHome ?? path.resolve(".codex-home-planner");
            inheritCodexAuthFiles(plannerHome);

            const tmpOut = path.join(path.resolve(".splitshot/_tmp"), `plan-last-${Date.now()}.json`);
            if (opts.debug) console.error(`[debug] output-last-message: ${feats.hasOutputLastMessage ? "enabled" : "disabled"}`);
            if (opts.debug && feats.hasOutputLastMessage) console.error(`[debug] last-message path: ${tmpOut}`);
            const res = await execCodexWithSchema({
                bin: opts.codexBin,
                schemaPath,
                prompt,
                plannerHome,
                timeoutMs: opts.timeout,
                outputLastMessagePath: feats.hasOutputLastMessage ? tmpOut : undefined,
                extraArgs: ["--cd", planDir],
                colorNever: true,
            });
            if (opts.debug) {
                console.error("[debug] codex stdout:\n" + res.rawStdout);
                console.error(`[debug] output-last-message: ${feats.hasOutputLastMessage ? "enabled" : "disabled"}`);
                if (feats.hasOutputLastMessage) console.error(`[debug] last-message path: ${tmpOut} (exists=${fs.existsSync(tmpOut)})`);
            }

            // 6) Parse & validate JSON (Zod)

            // === 7) Persist Codex artifacts in plan-dir ===
            // Save codex raw input/output when debug enabled (also keep even if not to help reproduction)
            try {
                writeFileUtf8(path.join(planDir, "codex.input.txt"), prompt);
                writeFileUtf8(path.join(planDir, "codex.raw.stdout.txt"), res.rawStdout);
                writeFileUtf8(path.join(planDir, "codex.raw.stderr.txt"), res.rawStderr);
                if (res.usedLastMessage && res.lastMessagePath && fs.existsSync(res.lastMessagePath)) {
                    fs.copyFileSync(res.lastMessagePath, path.join(planDir, "codex.last-message.raw.txt"));
                }
            } catch (e) {
                // non-fatal
                console.error("Failed to write codex debug files:", e instanceof Error ? e.message : String(e));
            }
            const fallbackPlanPath = path.join(planDir, "plan.stub.json");
            writeFileUtf8(path.join(planDir, "codex.stdout.captured.txt"), res.text);
            let planText = "";
            if (fs.existsSync(fallbackPlanPath)) {
                try {
                    planText = fs.readFileSync(fallbackPlanPath, "utf8").trim();
                    if (planText && opts.debug) {
                        console.error(`[debug] using fallback plan at ${fallbackPlanPath}`);
                    }
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    throw new Error(`Failed to read fallback plan at ${fallbackPlanPath}: ${msg}`);
                }
            }
            if (!planText) {
                planText = res.text.trim();
            }
            if (!planText) {
                throw new Error(
                    `Codex returned empty plan output (stdout empty and fallback plan at ${fallbackPlanPath} was blank)`
                );
            }
            if (opts.debug) {
                console.error(`[debug] plan text length=${planText.length}`);
            }

            // Save raw plan & prompt
            let plan: Plan;
            try {
                plan = parsePlanFromText(planText) as Plan;
            } catch (err) {
                if (opts.debug) {
                    console.error("[debug] failed to parse plan text:");
                    console.error(planText);
                }
                throw err;
            }
            writeFileUtf8(path.join(planDir, "plan.json"), JSON.stringify(plan, null, 2));
            writeFileUtf8(path.join(planDir, "plan.prompt.txt"), prompt);
            writeFileUtf8(path.join(planDir, "plan.raw.json"), planText);
            if (feats.hasOutputLastMessage && fs.existsSync(tmpOut)) {
                const last = fs.readFileSync(tmpOut, "utf8");
                writeFileUtf8(path.join(planDir, "codex.last-message.json"), last);
            }

            // === 8) Build topo order then distribute to N worker streams (round robin) ===
            const layers = buildBatches(plan.tasks);
            const topo = layers.flat();
            const N = Math.max(1, Number.isFinite(opts.workers) ? opts.workers : 1);
            const streams: typeof topo[] = Array.from({ length: N }, () => []);
            for (let i = 0; i < topo.length; i++) {
                streams[i % N].push(topo[i]);
            }

            const workerTodoById = new Map<string, string>();
            for (const file of plan.generatedFiles) {
                if (file.role === "worker-todo" && file.workerId && isSafeRelativeUnder(planDir, file.path)) {
                    workerTodoById.set(file.workerId, file.path);
                }
            }

            // Load checklist template
            const tplPath = path.resolve("src/templates/checklist.md.tpl");
            const tpl = fs.existsSync(tplPath)
                ? fs.readFileSync(tplPath, "utf8")
                : "# Worker <ID> — TODO Checklist\n\n## Context\n<OBJECTIVE>\n\n## Tasks\n<TASKS>\n\n## Notes\n- 出力は JSONL も含めて行単位でわかるように\n- 重要メトリクスは最後に箇条書きで報告\n";

            const workers: { id: string; checklist: string; todo?: string }[] = [];
            const objectiveExcerpt = objective.trim().slice(0, 800);
            const pad2 = (n: number) => String(n).padStart(2, "0");
            for (let i = 0; i < streams.length; i++) {
                const wid = `w${pad2(i + 1)}`;
                const rel = `checklists/worker-${pad2(i + 1)}.md`;
                const abs = path.join(planDir, rel);
                const tasksMd = streams[i]
                    .map(
                        (t) =>
                            `- [ ] ${t.id}: ${t.title}\n  - Summary: ${t.summary || "-"}\n  - Acceptance: ${t.acceptanceCriteria || "-"}`
                    )
                    .join("\n");
                const body = tpl
                    .replaceAll("<ID>", pad2(i + 1))
                    .replaceAll("<OBJECTIVE>", objectiveExcerpt || "(no objective excerpt)")
                    .replaceAll("<TASKS>", tasksMd || "- [ ] (no tasks)");
                writeFileUtf8(abs, body);
                const workerEntry: { id: string; checklist: string; todo?: string } = { id: wid, checklist: rel };
                const todoPath = workerTodoById.get(wid);
                if (todoPath) workerEntry.todo = todoPath;
                workers.push(workerEntry);
            }

            const docsIndexEntries = plan.generatedFiles.map((file) => {
                const rel = file.path;
                const safe = isSafeRelativeUnder(planDir, rel);
                if (!safe) {
                    return {
                        path: rel,
                        role: file.role,
                        workerId: file.workerId,
                        validPath: false,
                        exists: false,
                        bytes: 0,
                        sha256: "",
                    };
                }

                const abs = path.resolve(planDir, rel);
                try {
                    const stat = fs.statSync(abs);
                    if (!stat.isFile()) {
                        return {
                            path: rel,
                            role: file.role,
                            workerId: file.workerId,
                            validPath: true,
                            exists: false,
                            bytes: 0,
                            sha256: "",
                        };
                    }
                    const data = fs.readFileSync(abs);
                    return {
                        path: rel,
                        role: file.role,
                        workerId: file.workerId,
                        validPath: true,
                        exists: true,
                        bytes: data.byteLength,
                        sha256: createHash("sha256").update(data).digest("hex"),
                    };
                } catch {
                    return {
                        path: rel,
                        role: file.role,
                        workerId: file.workerId,
                        validPath: true,
                        exists: false,
                        bytes: 0,
                        sha256: "",
                    };
                }
            });

            const docsIndexRel = path.join("docs", "docs.index.json");
            const docsIndexAbs = path.join(planDir, docsIndexRel);
            const docsIndex = {
                generatedAt: new Date().toISOString(),
                files: docsIndexEntries,
            };
            try {
                writeFileUtf8(docsIndexAbs, JSON.stringify(docsIndex, null, 2));
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                throw new Error(`Failed to write docs index at ${docsIndexAbs}: ${msg}`);
            }

            // Manifest
            const manifest = {
                version: 1 as const,
                objective: objectiveExcerpt || "(no objective provided)",
                createdAt: new Date().toISOString(),
                docsIndex: docsIndexRel,
                workers,
            };
            writeFileUtf8(path.join(planDir, "manifest.json"), JSON.stringify(manifest, null, 2));

            // Emit machine-friendly pointer to plan-dir
            process.stdout.write(JSON.stringify({ planDir }, null, 2) + "\n");
        });

    return cmd;
}
