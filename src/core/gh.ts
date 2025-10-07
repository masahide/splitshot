import { execa } from "execa";

export class GhError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = "GhError";
        if (cause && typeof cause === "object") {
            (this as { cause?: unknown }).cause = cause;
        }
    }
}

export interface GhRunOptions {
    bin: string;
    args: string[];
    cwd: string;
    env?: NodeJS.ProcessEnv;
}

export async function runGh(opts: GhRunOptions) {
    try {
        return await execa(opts.bin, opts.args, { cwd: opts.cwd, env: opts.env, stdout: "pipe", stderr: "pipe" });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new GhError(message, err);
    }
}
