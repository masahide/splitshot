import fs from "node:fs";
import path from "node:path";

export class JsonlFollower {
    private timer?: NodeJS.Timeout;
    private positions = new Map<string, number>();
    private stopped = false;
    constructor(
        private sessionsDir: string,
        private onLine: (line: string) => void,
        private intervalMs = 200
    ) { }

    start() {
        const tick = () => {
            if (this.stopped) return;
            try {
                if (fs.existsSync(this.sessionsDir)) {
                    const stack = this.listJsonl(this.sessionsDir);
                    for (const fp of stack) this.drain(fp);
                }
            } catch {
                // noop
            }
            this.timer = setTimeout(tick, this.intervalMs);
        };
        tick();
    }

    stop() {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
    }

    private listJsonl(dir: string): string[] {
        const out: string[] = [];
        for (const ent of safeReaddir(dir)) {
            const p = path.join(dir, ent);
            const st = safeStat(p);
            if (st?.isDirectory()) out.push(...this.listJsonl(p));
            else if (/rollout-.*\.jsonl$/.test(ent)) out.push(p);
        }
        return out.sort();
    }

    private drain(fp: string) {
        const pos = this.positions.get(fp) ?? 0;
        const st = safeStat(fp);
        if (!st) return;
        if (st.size < pos) {
            this.positions.set(fp, 0);
            return;
        }
        if (st.size === pos) return;
        const fd = fs.openSync(fp, "r");
        try {
            const len = st.size - pos;
            const buf = Buffer.allocUnsafe(len);
            fs.readSync(fd, buf, 0, len, pos);
            this.positions.set(fp, st.size);
            const text = buf.toString("utf8");
            for (const line of text.split(/\r?\n/)) {
                if (!line.trim()) continue;
                this.onLine(line);
            }
        } finally {
            fs.closeSync(fd);
        }
    }
}

function safeReaddir(dir: string): string[] {
    try {
        return fs.readdirSync(dir);
    } catch {
        return [];
    }
}
function safeStat(p: string) {
    try {
        return fs.statSync(p);
    } catch {
        return undefined;
    }
}