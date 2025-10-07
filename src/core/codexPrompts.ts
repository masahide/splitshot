import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PRESET = "default";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..", "..");
const templatesRoot = path.join(projectRoot, "src/templates/prompts");

function readTemplateDir(presetName: string): string {
    const presetDir = path.join(templatesRoot, presetName);
    if (!fs.existsSync(presetDir) || !fs.statSync(presetDir).isDirectory()) {
        throw new Error(`Prompt preset not found: ${presetDir}`);
    }
    return presetDir;
}

export function resolveCodexHome(options?: { home?: string; env?: NodeJS.ProcessEnv }): string {
    if (options?.home) {
        return path.resolve(options.home);
    }
    const env = options?.env ?? process.env;
    const envHome = env.CODEX_HOME;
    if (envHome && envHome.trim().length > 0) {
        return path.resolve(envHome);
    }
    return path.join(os.homedir(), ".codex");
}

export function installPromptSet(targetHome: string, presetName = DEFAULT_PRESET): void {
    const sourceDir = readTemplateDir(presetName);
    const resolvedHome = path.resolve(targetHome);
    const promptsDir = path.join(resolvedHome, "prompts");
    fs.mkdirSync(promptsDir, { recursive: true });
    const entries = fs.readdirSync(sourceDir);
    for (const entry of entries) {
        const src = path.join(sourceDir, entry);
        const stat = fs.statSync(src);
        if (!stat.isFile()) continue;
        const dest = path.join(promptsDir, entry);
        fs.copyFileSync(src, dest);
    }
}

export function renderPrompt(template: string, argv: string[]): string {
    const placeholder = "__SPLITSHOT_DOLLAR__";
    let result = template.replace(/\$\$/g, placeholder);
    const argsJoined = argv.join(" ");
    result = result.replace(/\$ARGUMENTS/g, argsJoined);
    result = result.replace(/\$(\d)/g, (_match, digit) => {
        const index = Number(digit) - 1;
        return index >= 0 && index < argv.length ? argv[index] : "";
    });
    result = result.replace(new RegExp(placeholder, "g"), "$");
    return result;
}
