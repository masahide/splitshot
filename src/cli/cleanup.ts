import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { findLatestPlanDir } from "../core/paths.js";
import { readManifestV3, writeManifestV3 } from "../core/manifest.js";
import { removeWorktrees, WORKTREE_REMOVED_MESSAGE } from "../core/worktrees.js";

function resolvePlanDir(planDirOption: string | undefined): string {
    if (planDirOption) {
        const abs = path.resolve(planDirOption);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
            throw new Error(`plan-dir が見つかりません: ${planDirOption}`);
        }
        return abs;
    }
    const base = path.resolve(".splitshot");
    const latest = findLatestPlanDir(base);
    if (!latest) {
        throw new Error("最新の plan-dir が見つかりません。`splitshot worktrees up` 実行後に利用してください。");
    }
    return latest;
}

export function cmdCleanup(): Command {
    const cmd = new Command("cleanup");
    cmd
        .description("使用済み worktree/branch を削除する")
        .option("--plan-dir <dir>", "対象の plan-dir")
        .option("--git-bin <path>", "git 実行バイナリ", process.env.FAKE_GIT_BIN ?? "git")
        .option("--force", "未マージでも強制削除する")
        .action(async (opts: { planDir?: string; gitBin: string; force?: boolean }) => {
            const repoDir = process.cwd();
            const planDir = resolvePlanDir(opts.planDir);
            const manifestPath = path.join(planDir, "manifest.v3.json");
            const manifest = readManifestV3(manifestPath);

            const updated = await removeWorktrees({
                repoDir,
                manifest,
                gitBin: opts.gitBin,
                force: Boolean(opts.force),
                env: process.env,
            });

            writeManifestV3(manifestPath, updated);
            console.log(WORKTREE_REMOVED_MESSAGE);
        });

    return cmd;
}
