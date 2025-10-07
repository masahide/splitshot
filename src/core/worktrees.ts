import path from "node:path";
import fs from "node:fs";
import { type ManifestV3 } from "./manifest.js";
import { runGit } from "./git.js";

function toPosix(value: string): string {
    return value.replace(/\\+/g, "/");
}

function padWorker(index: number): string {
    return String(index + 1).padStart(2, "0");
}

function ensureRelativePath(p: string): void {
    if (!p || path.isAbsolute(p)) {
        throw new Error(`相対パスのみ指定できます: ${p}`);
    }
}

export interface CreateWorktreesOptions {
    repoDir: string;
    planDir: string;
    manifest: ManifestV3;
    count: number;
    baseRelative: string;
    branchPrefix: string;
    startPoint: string;
    gitBin: string;
    env?: NodeJS.ProcessEnv;
}

export async function createWorktrees(opts: CreateWorktreesOptions): Promise<ManifestV3> {
    ensureRelativePath(opts.baseRelative);
    if (opts.manifest.worktrees.branches.length > 0) {
        throw new Error("既に worktree 情報が存在します。先に `worktrees down` を実行してください。");
    }
    const basePosix = toPosix(opts.baseRelative);
    const baseAbs = path.resolve(opts.repoDir, opts.baseRelative);
    fs.mkdirSync(baseAbs, { recursive: true });

    const branches = [] as ManifestV3["worktrees"]["branches"];

    for (let i = 0; i < opts.count; i += 1) {
        const suffix = padWorker(i);
        const worktreeDirRel = toPosix(path.join(opts.baseRelative, `agent-${suffix}`));
        const worktreeDirAbs = path.resolve(opts.repoDir, worktreeDirRel);
        const branchName = `${opts.branchPrefix}${suffix}`;
        branches.push({
            id: `w${suffix}`,
            branch: branchName,
            dir: toPosix(path.relative(opts.repoDir, worktreeDirAbs)),
        });
        await runGit({
            bin: opts.gitBin,
            args: [
                "worktree",
                "add",
                worktreeDirAbs,
                "-b",
                branchName,
                opts.startPoint,
            ],
            cwd: opts.repoDir,
            env: opts.env,
        });
    }

    return {
        ...opts.manifest,
        worktrees: {
            base: basePosix,
            branches,
        },
    };
}

export interface RemoveWorktreesOptions {
    repoDir: string;
    manifest: ManifestV3;
    gitBin: string;
    force: boolean;
    env?: NodeJS.ProcessEnv;
}

function parseMergedBranches(output: string): Set<string> {
    const merged = new Set<string>();
    for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const name = trimmed.replace(/^[*]\s*/, "");
        if (name) merged.add(name);
    }
    return merged;
}

export async function removeWorktrees(opts: RemoveWorktreesOptions): Promise<ManifestV3> {
    const { manifest } = opts;
    if (manifest.worktrees.branches.length === 0) {
        return manifest;
    }

    if (!opts.force) {
        const { stdout } = await runGit({
            bin: opts.gitBin,
            args: ["branch", "--merged"],
            cwd: opts.repoDir,
            env: opts.env,
        });
        const merged = parseMergedBranches(stdout);
        const unmerged = manifest.worktrees.branches
            .map((entry) => entry.branch)
            .filter((branch) => !merged.has(branch));
        if (unmerged.length > 0) {
            throw new Error(
                `未マージのブランチが存在するため削除できません: ${unmerged.join(", ")}. --force を指定してください。`
            );
        }
    }

    for (const entry of manifest.worktrees.branches) {
        const worktreeDirAbs = path.resolve(opts.repoDir, entry.dir);
        const removeArgs = ["worktree", "remove"] as string[];
        if (opts.force) {
            removeArgs.push("--force");
        }
        removeArgs.push(worktreeDirAbs);
        await runGit({
            bin: opts.gitBin,
            args: removeArgs,
            cwd: opts.repoDir,
            env: opts.env,
        });

        const branchArgs = ["branch", opts.force ? "-D" : "-d", entry.branch];
        await runGit({
            bin: opts.gitBin,
            args: branchArgs,
            cwd: opts.repoDir,
            env: opts.env,
        });

        if (fs.existsSync(worktreeDirAbs)) {
            fs.rmSync(worktreeDirAbs, { recursive: true, force: true });
        }
    }

    return {
        ...manifest,
        worktrees: {
            ...manifest.worktrees,
            branches: [],
        },
    };
}

export function formatWorktreeCreationMessage(count: number, baseRelative: string): string {
    return `worktree を ${count} 件作成しました (${baseRelative})`;
}

export const WORKTREE_REMOVED_MESSAGE = "worktree を削除しました";
