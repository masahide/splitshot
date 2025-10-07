import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { findLatestPlanDir } from "../core/paths.js";
import { readManifestV3, writeManifestV3 } from "../core/manifest.js";
import {
    createWorktrees,
    removeWorktrees,
    formatWorktreeCreationMessage,
    WORKTREE_REMOVED_MESSAGE,
} from "../core/worktrees.js";

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
        throw new Error("最新の plan-dir が見つかりません。先に step3 を実行してください。");
    }
    return latest;
}

function parseCount(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`count は正の整数で指定してください: ${raw}`);
    }
    return value;
}

export function cmdWorktrees(): Command {
    const cmd = new Command("worktrees");
    cmd.description("Git worktree 管理コマンド");

    cmd
        .command("up")
        .description("指定数の worktree を作成し manifest を更新する")
        .option("--plan-dir <dir>", "対象の plan-dir", undefined)
        .option("--count <number>", "作成する worktree の数 (既定: TODO 件数)")
        .option("--base <dir>", "リポジトリからの相対パス (既定: ../worktrees)")
        .option("--branch-prefix <prefix>", "ブランチ名のプレフィックス", "feature/agent-")
        .option("--start-point <ref>", "作成元の Git リファレンス", "main")
        .option("--git-bin <path>", "git 実行バイナリ", process.env.FAKE_GIT_BIN ?? "git")
        .action(async (opts: {
            planDir?: string;
            count?: string;
            base?: string;
            branchPrefix: string;
            startPoint: string;
            gitBin: string;
        }) => {
            const repoDir = process.cwd();
            const planDir = resolvePlanDir(opts.planDir);
            const manifestPath = path.join(planDir, "manifest.v3.json");
            const manifest = readManifestV3(manifestPath);
            const count = parseCount(opts.count, manifest.docs.todos.length);
            const baseRelative = opts.base ?? "../worktrees";
            const updated = await createWorktrees({
                repoDir,
                planDir,
                manifest,
                count,
                baseRelative,
                branchPrefix: opts.branchPrefix,
                startPoint: opts.startPoint,
                gitBin: opts.gitBin,
                env: process.env,
            });
            writeManifestV3(manifestPath, updated);
            console.log(formatWorktreeCreationMessage(count, baseRelative));
        });

    cmd
        .command("down")
        .description("manifest に基づき worktree を削除する")
        .option("--plan-dir <dir>", "対象の plan-dir", undefined)
        .option("--git-bin <path>", "git 実行バイナリ", process.env.FAKE_GIT_BIN ?? "git")
        .option("--force", "未マージでも強制削除する", false)
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
