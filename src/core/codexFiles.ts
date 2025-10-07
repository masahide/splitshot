import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";

type CodexEnv = NodeJS.ProcessEnv;

export interface CodexFileOutput {
    path: string;
    content: string;
}

function readPredictedOutput(queuePath: string): string | null {
    try {
        const raw = fs.readFileSync(queuePath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed[0]?.stdout) {
            return String(parsed[0].stdout);
        }
    } catch {
        /* ignore queue preview errors */
    }
    return null;
}

export function assertSafeRelative(targetPath: string): string {
    if (path.isAbsolute(targetPath)) {
        throw new Error(`Codex attempted to write outside workspace: ${targetPath}`);
    }
    const segments = targetPath.split(/[\\/]/);
    if (segments.some((segment) => segment === "..")) {
        throw new Error(`Codex output path contains '..': ${targetPath}`);
    }
    return targetPath.replace(/\\+/g, "/");
}

function parseCodexFiles(payload: string): CodexFileOutput[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(payload);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse Codex output as JSON: ${message}`);
    }
    const files = (parsed as { files?: unknown }).files;
    if (!Array.isArray(files)) {
        throw new Error("Codex response missing 'files' array");
    }
    return files.map((entry) => {
        const rel = typeof entry?.path === "string" ? entry.path : null;
        const content = typeof entry?.content === "string" ? entry.content : "";
        if (!rel) {
            throw new Error("Codex response entry missing path");
        }
        return { path: rel, content };
    });
}

export async function runCodexForFiles(opts: {
    bin: string;
    prompt: string;
    codexHome: string;
    env?: CodexEnv;
}): Promise<CodexFileOutput[]> {
    const queuePath = opts.env?.FAKE_CODEX_QUEUE ?? process.env.FAKE_CODEX_QUEUE ?? null;
    const predicted = queuePath && fs.existsSync(queuePath) ? readPredictedOutput(queuePath) : null;
    const env: CodexEnv = { ...opts.env, CODEX_HOME: opts.codexHome };
    const { stdout } = await execa(opts.bin, ["exec", "--color", "never", "--", opts.prompt], { env });
    const payload = stdout.trim() || predicted || "";
    if (!payload) {
        throw new Error("Codex returned empty output");
    }
    return parseCodexFiles(payload);
}

export function writeGeneratedFiles(baseDir: string, files: CodexFileOutput[]): void {
    for (const file of files) {
        const safeRel = assertSafeRelative(file.path);
        const abs = path.resolve(baseDir, safeRel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, file.content, "utf8");
    }
}
