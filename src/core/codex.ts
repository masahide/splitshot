import { execa } from "execa";
import fs from "fs";
import path from "path";

export type CodexFeatures = { hasOutputSchema: boolean; hasJson: boolean };

export type ExecPlanArgs = {
    bin?: string;
    schemaPath: string;
    prompt: string;
    plannerHome?: string; // CODEX_HOME for planner
    extraArgs?: string[];
    timeoutMs?: number;
};

export async function execCodexWithSchema(a: ExecPlanArgs): Promise<string> {
    const bin = a.bin ?? "codex";
    const env = { ...process.env };
    if (a.plannerHome) {
        fs.mkdirSync(a.plannerHome, { recursive: true });
        env.CODEX_HOME = path.resolve(a.plannerHome);
    }
    const args = [
        "exec",
        "--output-schema", a.schemaPath,
        "--quiet",
        "--json",
        ...(a.extraArgs ?? []),
        "--",
        a.prompt
    ];

    const { stdout } = await execa(bin, args, {
        env,
        timeout: a.timeoutMs ?? 120_000,
    });
    return stdout.trim();
}



async function help(bin: string, args: string[]) {
    try {
        const { stdout, stderr } = await execa(bin, args, { reject: false });
        return (stdout || "") + "\n" + (stderr || "");
    } catch {
        return "";
    }
}

export async function detectCodexFeatures(bin = "codex"): Promise<CodexFeatures> {
    // 3パターンの help を総当り
    const texts = await Promise.all([
        help(bin, ["exec", "--help"]),
        help(bin, ["help", "exec"]),
        help(bin, ["--help"]),
    ]);
    const text = texts.join("\n").toLowerCase();

    // ハイフンの数や空白に頑健な判定
    const hasOutputSchema = /--output\s*-\s*schema|--output-schema/.test(text);
    const hasJson = /\s--json(\s|$)/.test(text) || /print.*jsonl/.test(text);

    return { hasOutputSchema, hasJson };
}
