import { describe, it, expect } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { parseEventLine, type EventRecord, type StateEvent } from "../src/core/events";


const cli = path.resolve("dist/cli/index.js");
const stub = path.resolve("tests/fixtures/codex-runner-stub.js");
const codexStub = path.resolve("tests/fixtures/codex-stub.js");

function readLines(p: string) {
    return fs.readFileSync(p, "utf8").trim().split(/\r?\n/).filter(Boolean);
}

describe("run: failure handling (2-mode)", () => {
    it("exits non-zero when one worker fails; events are recorded under plan-dir/.runs", async () => {
        // 1) plan-dir を作成（workers=2）
        const planRes = await execa(process.execPath, [
            cli, "plan",
            "--objective", "fail-propagation-check",
            "--workers", "2",
            "--codex-bin", codexStub
        ]);
        const { planDir } = JSON.parse(planRes.stdout);
        expect(typeof planDir).toBe("string");

        // 2) w01 を強制失敗させて run
        const runRes = await execa(process.execPath, [
            cli, "run",
            "--plan-dir", planDir,
            "--codex-bin", stub,
            "--max-parallel", "2"
        ], {
            env: { ...process.env, SPLITSHOT_FORCE_FAIL_TASK_IDS: "w01" },
            reject: false // 失敗コードでも投げない
        });
        expect(runRes.exitCode).not.toBe(0); // いずれか失敗で非0

        // 3) latest.json → events.ndjson
        const latest = JSON.parse(
            fs.readFileSync(path.join(planDir, ".runs", "latest.json"), "utf8")
        );
        const evs: EventRecord[] = readLines(path.join(latest.runDir, "events.ndjson"))
            .map(parseEventLine)
            .filter((e): e is EventRecord => e !== null);

        // state:start が w01 / w02 で記録されている
        const starts = evs
            .filter((e): e is StateEvent => e.type === "state" && e.data.phase === "start")
            .map((e) => e.runId);
        expect(new Set(starts)).toEqual(new Set(["w01", "w02"]));

        // w01 の exit(code!=0) がある
        const w01exit = evs.find(
            (e): e is StateEvent => e.type === "state" && e.runId === "w01" && e.data.phase === "exit"
        );
        expect(w01exit && w01exit.data.phase === "exit" ? w01exit.data.code : undefined).not.toBe(0);


        // w02 も exit を迎えている（成功/失敗は問わない）
        const w02exit = evs.find((e): e is StateEvent => e.type === "state" && e.runId === "w02" && e.data.phase === "exit");

        expect(w02exit).toBeTruthy();
    });
});