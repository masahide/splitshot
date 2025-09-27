import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type TmpCtx = {
    dir: string;
    path: (...segs: string[]) => string;
    cleanup: () => void;
};

/** プレフィックス付きの一時ワークディレクトリを作って返す（手動 cleanup 用） */
export function mkTmpWork(prefix = "splitshot-"): TmpCtx {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const cleanup = () => {
        try {
            fs.rmSync(base, { recursive: true, force: true });
        } catch (_err) {
            // noop: best-effort cleanup; ignore errors
            void _err;
        }
    };
    return { dir: base, path: (...segs) => path.join(base, ...segs), cleanup };
}

/** 一時ワークディレクトリで関数を実行し、必ず掃除する */
export async function withTmp<T>(
    fn: (ctx: Pick<TmpCtx, "dir" | "path">) => Promise<T> | T,
    prefix = "splitshot-"
): Promise<T> {
    const ctx = mkTmpWork(prefix);
    try { return await fn({ dir: ctx.dir, path: ctx.path }); }
    finally { ctx.cleanup(); }
}
