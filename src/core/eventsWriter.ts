import fs from "node:fs";
import path from "node:path";
import type { EventRecord } from "./events.js";

export function createEventsWriter(filepath: string) {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    const ws = fs.createWriteStream(filepath, { flags: "a" });
    let queued = 0;
    return {
        write(obj: EventRecord) {
            // 行バッファ詰まり対策で軽くcork/uncork
            if (++queued % 200 === 0) ws.cork();
            ws.write(JSON.stringify(obj) + "\n");
            if (queued % 200 === 0) process.nextTick(() => ws.uncork());
        },
        async close() {
            await new Promise<void>((r) => ws.end(r));
        },
    };
}