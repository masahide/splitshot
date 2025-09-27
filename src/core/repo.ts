import { execa } from "execa";
import path from "node:path";

export type RepoInfo = { root?: string; branch?: string; headSha?: string };

export async function detectRepoInfo(cwd: string): Promise<RepoInfo> {
    const info: RepoInfo = {};
    // repo root
    try {
        const { stdout, exitCode } = await execa("git", ["rev-parse", "--show-toplevel"], { cwd, reject: false });
        if (exitCode === 0 && stdout.trim()) info.root = path.resolve(stdout.trim());
    } catch { /* noop */ }
    if (!info.root) return info; // not a git repo

    // branch
    try {
        const { stdout, exitCode } = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: info.root, reject: false });
        if (exitCode === 0 && stdout.trim()) info.branch = stdout.trim();
    } catch { /* noop */ }
    if (!info.branch) {
        try {
            const { stdout, exitCode } = await execa("git", ["branch", "--show-current"], { cwd: info.root, reject: false });
            if (exitCode === 0 && stdout.trim()) info.branch = stdout.trim();
        } catch { /* noop */ }
    }

    // head sha
    try {
        const { stdout, exitCode } = await execa("git", ["rev-parse", "HEAD"], { cwd: info.root, reject: false });
        if (exitCode === 0 && stdout.trim()) info.headSha = stdout.trim();
    } catch { /* noop */ }

    return info;
}