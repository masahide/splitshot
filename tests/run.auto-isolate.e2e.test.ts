import { describe, it, expect } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { parseEventLine, type EventRecord, type StateEvent } from "../src/core/events";
import { findLatestPlanDir } from "../src/core/paths.js";
import { withTmp } from "./helpers/tmp";

const cli = path.resolve("dist/cli/index.js");
const stub = path.resolve("tests/fixtures/codex-runner-stub.js");
const codexStub = path.resolve("tests/fixtures/codex-plan-writes-files-stub.js");

function readLines(p: string) {
    return fs.readFileSync(p, "utf8").trim().split(/\r?\n/).filter(Boolean);
}

describe("run: CODEX_HOME conflicts", () => {
    it("fails without --auto-isolate", async () => {
        await withTmp(async ({ dir }) => {
            const planOut = path.join(dir, "plan-out");
            await execa(process.execPath, [
                cli,
                "plan",
                "--objective",
                "auto-isolate-test",
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
                cli, "run",
                "--plan-dir", planDir,
                "--codex-bin", stub,
                "--max-parallel", "2",
                "--codex-home-template", "<planDir>/.homes/.shared",
                "--no-auto-isolate"
            ], { cwd: dir, reject: false });

            expect(runRes.exitCode).not.toBe(0);
        });
    });

    it("succeeds with --auto-isolate and both tasks start", async () => {
        await withTmp(async ({ dir }) => {
            const planOut = path.join(dir, "plan-out");
            await execa(process.execPath, [
                cli,
                "plan",
                "--objective",
                "auto-isolate-test",
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
            const out = await execa(process.execPath, [
                cli, "run",
                "--plan-dir", planDir,
                "--codex-bin", stub,
                "--max-parallel", "2",
                "--codex-home-template", "<planDir>/.homes/.shared"
            ], { cwd: dir });
            expect(out.exitCode).toBe(0);

            const latest = JSON.parse(
                fs.readFileSync(path.join(planDir, ".runs", "latest.json"), "utf8")
            );
            const evs: EventRecord[] = readLines(path.join(latest.runDir, "events.ndjson"))
                .map(parseEventLine)
                .filter((e): e is EventRecord => e !== null);
            const starts = evs
                .filter((e): e is StateEvent => e.type === "state" && e.data.phase === "start")
                .map((e) => e.runId);
            expect(new Set(starts)).toEqual(new Set(["w01", "w02"]));
        });
    });
});
