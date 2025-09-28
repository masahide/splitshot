import { describe, it, expect } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { parseEventLine, type EventRecord, type StateEvent } from "../src/core/events";
import { findLatestPlanDir } from "../src/core/paths.js";
import { withTmp } from "./helpers/tmp";

const cli = path.resolve("dist/cli/index.js");
const runner = path.resolve("tests/fixtures/codex-runner-stub.js");
const codexStub = path.resolve("tests/fixtures/codex-plan-writes-files-stub.js");

function readLines(p: string) {
    return fs.readFileSync(p, "utf8").trim().split(/\r?\n/).filter(Boolean);
}


describe("run (E2E): maxParallel=1 emits events and serializes workers", () => {
    it("starts w01 then w02 when maxParallel=1", async () => {
        await withTmp(async ({ dir }) => {
            const planOut = path.join(dir, "plan-out");
            const objectiveSrc = path.join(dir, "objective.txt");
            fs.writeFileSync(objectiveSrc, "serial-run objective", "utf8");
            await execa(process.execPath, [
                cli,
                "plan",
                "--objective-file",
                objectiveSrc,
                "--workers",
                "2",
                "--codex-bin",
                codexStub,
                "--force-schema",
                "--out",
                planOut,
            ], { cwd: dir });
            const planDir = findLatestPlanDir(planOut);
            expect(planDir && fs.existsSync(planDir)).toBe(true);
            if (!planDir) throw new Error("planDir not found");
            const runRes = await execa(process.execPath, [
                cli, "run", "--plan-dir", planDir, "--codex-bin", runner, "--max-parallel", "1"
            ], { cwd: dir });
            expect(runRes.exitCode).toBe(0);

            const latest = JSON.parse(fs.readFileSync(path.join(planDir, ".runs", "latest.json"), "utf8"));
            const ev: EventRecord[] = readLines(path.join(latest.runDir, "events.ndjson"))
                .map(parseEventLine)
                .filter((e): e is EventRecord => e !== null);

            const starts = ev
                .filter((e): e is StateEvent => e.type === "state" && e.data.phase === "start")
                .map((e) => e.runId);
            // w01 が先、w02 が後（manifest の順序通り）
            expect(starts[0]).toBe("w01");
            expect(starts[1]).toBe("w02");
        });
    });
});
