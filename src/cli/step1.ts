import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { renderPrompt, resolveCodexHome } from "../core/codexPrompts.js";
import { runCodexForFiles, writeGeneratedFiles, assertSafeRelative } from "../core/codexFiles.js";
import { upsertDocsIndex } from "../core/docsIndex.js";

function ensureFileExists(filePath: string): string {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        throw new Error(`Objective file not found: ${filePath}`);
    }
    return abs;
}

export function cmdStep1(): Command {
    const cmd = new Command("step1");
    cmd.description("Step1 automation commands");

    cmd
        .command("spec")
        .description("Generate docs/spec.md using Codex")
        .requiredOption("--objective <file>", "Path to objective file")
        .option("--codex-home <dir>", "Override CODEX_HOME directory")
        .option("--codex-bin <path>", "Codex binary", process.env.FAKE_CODEX_BIN ?? "codex")
        .action(async (opts: { objective: string; codexHome?: string; codexBin: string }) => {
            try {
                const objectiveAbs = ensureFileExists(opts.objective);
                const objectiveRel = path.relative(process.cwd(), objectiveAbs);
                const objectiveContent = fs.readFileSync(objectiveAbs, "utf8");
                const codexHome = resolveCodexHome({ home: opts.codexHome });
                const promptPath = path.join(codexHome, "prompts", "spec.md");
                if (!fs.existsSync(promptPath) || !fs.statSync(promptPath).isFile()) {
                    throw new Error(`Prompt template not found at ${promptPath}`);
                }
                const template = fs.readFileSync(promptPath, "utf8");
                const prompt = renderPrompt(template, [objectiveRel, objectiveContent]);
                const files = await runCodexForFiles({
                    bin: opts.codexBin,
                    prompt,
                    codexHome,
                    env: process.env,
                });
                writeGeneratedFiles(process.cwd(), files);

                const indexPath = path.resolve("docs/docs.index.json");
                for (const file of files) {
                    upsertDocsIndex(indexPath, {
                        path: assertSafeRelative(file.path),
                        generatedBy: "step1:spec",
                    });
                }
                console.log("docs/spec.md generated");
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                throw new Error(message);
            }
        });

    return cmd;
}
