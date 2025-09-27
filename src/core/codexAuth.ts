// src/core/codexAuth.ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function inheritCodexAuthFiles(targetHome: string) {
    const userDir = path.join(os.homedir(), ".codex");
    const authSrc = path.join(userDir, "auth.json");
    const cfgSrc = path.join(userDir, "config.toml");
    fs.mkdirSync(targetHome, { recursive: true });

    const linkOrCopy = (src: string, dest: string) => {
        if (!fs.existsSync(src) || fs.existsSync(dest)) return;
        try {
            fs.symlinkSync(src, dest);
        } catch {
            fs.copyFileSync(src, dest);
        }
    };

    try {
        linkOrCopy(authSrc, path.join(targetHome, "auth.json"));
        linkOrCopy(cfgSrc, path.join(targetHome, "config.toml"));
    } catch {
        // 継承失敗は致命ではない（無視）。必要なら 401 で気づく。
    }
}
