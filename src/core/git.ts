import { execa } from "execa";

export class GitError extends Error {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number | undefined;

    constructor(message: string, opts: { cause?: unknown; stdout?: string; stderr?: string; exitCode?: number } = {}) {
        super(message);
        this.name = "GitError";
        this.stdout = opts.stdout ?? "";
        this.stderr = opts.stderr ?? "";
        this.exitCode = opts.exitCode;
        if (opts.cause && typeof opts.cause === "object") {
            (this as { cause?: unknown }).cause = opts.cause;
        }
    }
}

export interface GitRunOptions {
    bin: string;
    args: string[];
    cwd: string;
    env?: NodeJS.ProcessEnv;
    allowFailure?: boolean;
}

export async function runGit(opts: GitRunOptions) {
    try {
        return await execa(opts.bin, opts.args, { cwd: opts.cwd, env: opts.env, stdout: "pipe", stderr: "pipe" });
    } catch (err) {
        if (opts.allowFailure) {
            return { stdout: "", stderr: "" };
        }
        if (err && typeof err === "object" && "stdout" in err && "stderr" in err) {
            const stdout = String((err as { stdout: unknown }).stdout ?? "");
            const stderr = String((err as { stderr: unknown }).stderr ?? "");
            const exitCode = (err as { exitCode?: number }).exitCode;
            const message = err instanceof Error ? err.message : String(err);
            throw new GitError(message, { cause: err, stdout, stderr, exitCode });
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new GitError(message, { cause: err });
    }
}
