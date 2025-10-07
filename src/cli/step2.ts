import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { renderPrompt, resolveCodexHome } from "../core/codexPrompts.js";
import { runCodexForFiles, writeGeneratedFiles, assertSafeRelative } from "../core/codexFiles.js";
import { upsertDocsIndex } from "../core/docsIndex.js";

function ensureFile(pathLike: string): string {
    const abs = path.resolve(pathLike);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        throw new Error(`Required file not found: ${pathLike}`);
    }
    return abs;
}

export function cmdStep2(): Command {
    const cmd = new Command("step2");
    cmd.description("Step2 automation commands");

    cmd
        .command("design")
        .description("Generate interface and todo documents using Codex")
        .option("--codex-home <dir>", "Override CODEX_HOME directory")
        .option("--codex-bin <path>", "Codex binary", process.env.FAKE_CODEX_BIN ?? "codex")
        .action(async (opts: { codexHome?: string; codexBin: string }) => {
            const specPath = ensureFile("docs/spec.md");
            const specRel = path.relative(process.cwd(), specPath);
            const specContent = fs.readFileSync(specPath, "utf8");

            const codexHome = resolveCodexHome({ home: opts.codexHome });
            const promptPath = path.join(codexHome, "prompts", "split.md");
            if (!fs.existsSync(promptPath) || !fs.statSync(promptPath).isFile()) {
                throw new Error(`Prompt template not found at ${promptPath}`);
            }
            const template = fs.readFileSync(promptPath, "utf8");
            const prompt = renderPrompt(template, [specRel, specContent]);

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
                    generatedBy: "step2:design",
                });
            }
            console.log("design documents generated");
        });

    return cmd;
}
