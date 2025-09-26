// src/cli/plan.ts
// Generate a parallel task plan via Codex (--output-schema) and print validated JSON

import { Command } from "commander";
import fs from "fs";
import path from "path";
import { detectCodexFeatures, execCodexWithSchema } from "../core/codex";
import { loadSchema, assertValid } from "../core/schema";
import { buildPlannerPrompt } from "../core/planner";
import type { Plan } from "../core/types";

async function readMaybeFile(v?: string): Promise<string | undefined> {
    if (!v) return;
    const p = path.resolve(String(v));
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return fs.readFileSync(p, "utf8");
    return v;
}

export function cmdPlan() {
    const cmd = new Command("plan");
    cmd
        .description("Generate parallel task plan via Codex --output-schema")
        .option("--objective <fileOrText>", "Objective file path or raw text")
        .option("--workers <n>", "Workers hint", (v) => parseInt(v, 10), 3)
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

            // 7) Persist artifacts for reproducibility
            const outDir = path.resolve(".codex-parallel");
            fs.mkdirSync(outDir, { recursive: true });
            const ts = Date.now();
            fs.writeFileSync(
                path.join(outDir, `plan-${ts}.json`),
                JSON.stringify(plan, null, 2),
                "utf8"
            );
            fs.writeFileSync(path.join(outDir, `plan.prompt-${ts}.txt`), prompt, "utf8");

            // 8) Emit to stdout (tooling-friendly)
            process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
        });

    return cmd;
}
