import { describe, it, expect } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const cli = path.resolve("dist/cli/index.js");

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
        const { base, events } = mkWork("splitshot-tail-");
        const lines = [
            { t: Date.now(), type: "stdout", runId: "t1", data: { line: "A1" } },
            { t: Date.now(), type: "stderr", runId: "t2", data: { line: "B1" } },
            { t: Date.now(), type: "jsonl", runId: "t1", data: { line: '{"ok":1}' } },
            { t: Date.now(), type: "state", runId: "t1", data: { phase: "start" } },
        ];
        fs.writeFileSync(events, lines.map((o) => JSON.stringify(o)).join("\n") + "\n");

        const { stdout, exitCode } = await execa(process.execPath, [
            cli,
            "tail",
            "--run", "t1",
            "--type", "stdout,jsonl",
            // 明示的に events ファイルを指す（テスト補助オプション）
            "--events", events,
        ], { cwd: base });

        expect(exitCode).toBe(0);
        // t1 の stdout と jsonl は出る
        expect(stdout).toMatch(/"type":"stdout".*"runId":"t1"/s);
        expect(stdout).toMatch(/"type":"jsonl".*"runId":"t1"/s);
        // t2 の stderr は出ない
        expect(stdout).not.toMatch(/"runId":"t2".*"type":"stderr"/s);
        // state はフィルタされている
        expect(stdout).not.toMatch(/"type":"state"/);
    });

    it("follows appended lines within --duration window", async () => {
        const { base, events } = mkWork("splitshot-tail-");
        // 初期1行
        fs.writeFileSync(events, JSON.stringify({ t: Date.now(), type: "stdout", runId: "t1", data: { line: "first" } }) + "\n");

        // tail を起動（200msで自動終了）
        const proc = execa(process.execPath, [
            cli,
            "tail",
            "--run", "t1",
            "--type", "stdout",
            "--events", events,
            "--duration", "300"
        ], { cwd: base });

        // 追記を少し遅らせて書く
        await new Promise((r) => setTimeout(r, 80));
        fs.appendFileSync(events, JSON.stringify({ t: Date.now(), type: "stdout", runId: "t1", data: { line: "second" } }) + "\n");

        const { stdout, exitCode } = await proc;
        expect(exitCode).toBe(0);
        expect(stdout).toMatch(/"line":"first"/);
        expect(stdout).toMatch(/"line":"second"/);
    });
});
