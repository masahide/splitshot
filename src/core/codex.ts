import { execa } from "execa";
import fs from "fs";
import path from "path";

export type CodexFeatures = {
    hasOutputSchema: boolean;
    hasJson: boolean;
    hasOutputLastMessage: boolean;
};

export type ExecPlanArgs = {
    bin?: string;
    schemaPath: string;
    prompt: string;
    plannerHome?: string; // CODEX_HOME for planner
    extraArgs?: string[];
    timeoutMs?: number;
    /** If provided, pass --output-last-message <path> and prefer reading it */
    outputLastMessagePath?: string;
    /** Add --color never to reduce noisy output */
    colorNever?: boolean;
};

export type ExecText = {
    text: string;               // 最終的にプランとして解釈する文字列（last-message優先）
    rawStdout: string;          // 子プロセスの素のstdout
    rawStderr: string;          // 子プロセスの素のstderr
    usedLastMessage: boolean;   // last-messageを使ったか
    lastMessagePath?: string;
};

export async function execCodexWithSchema(a: ExecPlanArgs): Promise<ExecText> {
    const bin = a.bin ?? "codex";
    const env = { ...process.env };
    if (a.plannerHome) {
        fs.mkdirSync(a.plannerHome, { recursive: true });
        env.CODEX_HOME = path.resolve(a.plannerHome);
    }
    const args: string[] = ["exec", "--output-schema", a.schemaPath];
    if (a.outputLastMessagePath) {
        fs.mkdirSync(path.dirname(a.outputLastMessagePath), { recursive: true });
        args.push("--output-last-message", a.outputLastMessagePath);
    }
    if (a.colorNever) args.push("--color", "never");
    args.push(...(a.extraArgs ?? []), "--", a.prompt);
    const { stdout, stderr } = await execa(bin, args, {
        env,
        timeout: a.timeoutMs ?? 120_000,
    });
    let text = stdout.trim();
    let usedLastMessage = false;

    // 最終メッセージファイルがあればそれを優先
    if (a.outputLastMessagePath && fs.existsSync(a.outputLastMessagePath)) {
        text = fs.readFileSync(a.outputLastMessagePath, "utf8").trim();
        usedLastMessage = true;
    }
    return { text, rawStdout: stdout, rawStderr: stderr, usedLastMessage, lastMessagePath: a.outputLastMessagePath };
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
    const hasOutputLastMessage = /--output-last-message/.test(text);

    return { hasOutputSchema, hasJson, hasOutputLastMessage };
}
