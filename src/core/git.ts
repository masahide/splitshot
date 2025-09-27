import path from "node:path";

export type WorktreeAddParams = {
    gitRoot: string;       // リポジトリのルート（cwd）
    worktreeDir: string;   // 追加するワークツリーのパス
    branch: string;        // 作る/リセットするブランチ名
    baseRef?: string;      // 付け根（デフォルト HEAD）
    force?: boolean;       // --force を付けるか
    noCheckout?: boolean;  // --no-checkout を付けるか
};

export type WorktreeAddCommand = {
    cmd: string;
    args: string[];
    cwd: string;
};

/**
 * git worktree add の実行コマンドを生成（実行はしない）。
 * 例: git worktree add -B splitshot/t1 <worktreeDir> HEAD
 */
export function buildAddWorktreeCommand(p: WorktreeAddParams): WorktreeAddCommand {
    const args = ["worktree", "add"];
    if (p.force) args.push("--force");
    args.push("-B", p.branch);
    if (p.noCheckout) args.push("--no-checkout");
    args.push(path.resolve(p.worktreeDir), p.baseRef ?? "HEAD");
    return {
        cmd: "git",
        args,
        cwd: path.resolve(p.gitRoot),
    };
}