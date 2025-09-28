import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { tailOnce, tailFollow } from "../src/cli/tail.js";

function mkWork(prefix: string) {
    const base = fs.mkdtempSync(path.join(tmpdir(), prefix));
    const runs = path.join(base, ".codex-parallel", "runs");
    const runDir = path.join(runs, String(Date.now()));
    fs.mkdirSync(runDir, { recursive: true });
    // latest.json
    fs.writeFileSync(path.join(runs, "latest.json"), JSON.stringify({ runDir }, null, 2));
    return { base, runDir, events: path.join(runDir, "events.ndjson") };
}

describe("splitshot tail", () => {
    it("filters by --run and --type (no follow)", async () => {
        const { events } = mkWork("splitshot-tail-");
        const lines = [
            { t: Date.now(), type: "stdout", runId: "t1", data: { line: "A1" } },
            { t: Date.now(), type: "stderr", runId: "t2", data: { line: "B1" } },
            { t: Date.now(), type: "jsonl", runId: "t1", data: { line: '{"ok":1}' } },
            { t: Date.now(), type: "state", runId: "t1", data: { phase: "start" } },
        ];
        fs.writeFileSync(events, lines.map((o) => JSON.stringify(o)).join("\n") + "\n");

        const result = await tailOnce(events, "t1", new Set(["stdout", "jsonl"]));
        const out = result.join("\n");
        expect(out).toMatch(/"type":"stdout".*"runId":"t1"/s);
        expect(out).toMatch(/"type":"jsonl".*"runId":"t1"/s);
        expect(out).not.toMatch(/"runId":"t2".*"type":"stderr"/s);
        expect(out).not.toMatch(/"type":"state"/);
    });

    it("follows appended lines within --duration window", async () => {
        const { events } = mkWork("splitshot-tail-");
        // 初期1行
        fs.writeFileSync(events, JSON.stringify({ t: Date.now(), type: "stdout", runId: "t1", data: { line: "first" } }) + "\n");

        // tail を起動（200msで自動終了）
        await new Promise((r) => setTimeout(r, 80));
        fs.appendFileSync(events, JSON.stringify({ t: Date.now(), type: "stdout", runId: "t1", data: { line: "second" } }) + "\n");
        const follow = await tailFollow(events, "t1", new Set(["stdout"]), 300, 100);
        const joined = follow.join("\n");
        expect(joined).toMatch(/"line":"first"/);
        expect(joined).toMatch(/"line":"second"/);
    });
});
