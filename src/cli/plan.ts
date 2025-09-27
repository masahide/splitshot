import { Command } from "commander";
import fs from "fs";
import path from "path";
import { detectCodexFeatures, execCodexWithSchema } from "../core/codex";
import { loadSchema, assertValid } from "../core/schema";
import { buildPlannerPrompt } from "../core/planner";
import type { Plan } from "../core/types";
import { buildBatches } from "../core/scheduler.js";
import { ensureDir, createPlanDir, writeFileUtf8 } from "../core/paths.js";

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
        .option("--objective <fileOrText>", "Objective file path or raw text")
        .option("--workers <n>", "Workers hint", (v) => parseInt(v, 10), 3)
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

            // 2) Detect Codex features unless forced
            const feats = await detectCodexFeatures(opts.codexBin);
            if (!opts.forceSchema && !feats.hasOutputSchema) {
                throw new Error(
                    "codex does not support --output-schema (from help parsing). Use --force-schema to skip detection."
                );
            }

            // 3) Resolve schema & validator
            const schemaPath = path.resolve("src/templates/plan.schema.json");
            if (!fs.existsSync(schemaPath)) {
                throw new Error(`Schema file not found: ${schemaPath}`);
            }
            const validate = loadSchema(schemaPath);

            // 4) Build prompt for the planner
            const prompt = buildPlannerPrompt({
                objective,
                workers: opts.workers,
                avoidPaths: (opts.avoid?.split(",") ?? []).map((s: string) => s.trim()).filter(Boolean),
                mustPaths: (opts.must?.split(",") ?? []).map((s: string) => s.trim()).filter(Boolean),
                approval: opts.approval,
                model: opts.model,
            });

            // 5) Run Codex with structured outputs
            const stdout = await execCodexWithSchema({
                bin: opts.codexBin,
                schemaPath,
                prompt,
                plannerHome: opts.plannerHome ?? path.resolve(".codex-home-planner"),
                timeoutMs: opts.timeout,
            });

            // 6) Parse & validate JSON
            let json: unknown;
            try {
                json = JSON.parse(stdout);
            } catch {
                throw new Error(`Codex did not return valid JSON. Raw output:\n${stdout}`);
            }
            assertValid<Plan>(validate, json);
            const plan = json as Plan;

            // === 7) Create plan-dir structure ===
            const planBase = path.resolve(opts.out ?? ".splitshot");
            ensureDir(planBase);
            const planDir = createPlanDir(planBase);
            ensureDir(path.join(planDir, "checklists"));

            // Save raw plan & prompt
            writeFileUtf8(path.join(planDir, "plan.json"), JSON.stringify(plan, null, 2));
            writeFileUtf8(path.join(planDir, "plan.prompt.txt"), prompt);

            // === 8) Build topo order then distribute to N worker streams (round robin) ===
            const layers = buildBatches(plan.tasks);
            const topo = layers.flat();
            const N = Math.max(1, Number.isFinite(opts.workers) ? opts.workers : 1);
            const streams: typeof topo[] = Array.from({ length: N }, () => []);
            for (let i = 0; i < topo.length; i++) {
                streams[i % N].push(topo[i]);
            }

            // Load checklist template
            const tplPath = path.resolve("src/templates/checklist.md.tpl");
            const tpl = fs.existsSync(tplPath)
                ? fs.readFileSync(tplPath, "utf8")
                : "# Worker <ID> — TODO Checklist\n\n## Context\n<OBJECTIVE>\n\n## Tasks\n<TASKS>\n\n## Notes\n- 出力は JSONL も含めて行単位でわかるように\n- 重要メトリクスは最後に箇条書きで報告\n";

            const workers: { id: string; checklist: string }[] = [];
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
                workers.push({ id: wid, checklist: rel });
            }

            // Manifest
            const manifest = {
                version: 1 as const,
                objective: objectiveExcerpt || "(no objective provided)",
                createdAt: new Date().toISOString(),
                workers,
            };
            writeFileUtf8(path.join(planDir, "manifest.json"), JSON.stringify(manifest, null, 2));

            // Emit machine-friendly pointer to plan-dir
            process.stdout.write(JSON.stringify({ planDir }, null, 2) + "\n");
        });

    return cmd;
}
