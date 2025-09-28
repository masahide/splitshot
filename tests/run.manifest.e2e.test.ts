import { describe, it, expect } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { withTmp } from "./helpers/tmp";
import { findLatestPlanDir } from "../src/core/paths.js";

const cli = path.resolve("dist/cli/index.js");
const stub = path.resolve("tests/fixtures/codex-runner-stub.js");
const codexStub = path.resolve("tests/fixtures/codex-plan-writes-files-stub.js");

describe("run phase: manifest-driven parallel run", () => {
    it("runs workers from manifest and emits events.ndjson", async () => {
        await withTmp(async ({ dir }) => {
            const planOut = path.join(dir, "plan-out");
            const objectivePath = path.join(dir, "objective.txt");
            fs.writeFileSync(objectivePath, "Run manifest objective", "utf8");
            await execa(process.execPath, [
                cli,
                "plan",
                "--objective-file",
                "objective.txt",
                "--workers",
                "2",
                "--codex-bin",
                codexStub,
                "--out",
                planOut,
            ], { cwd: dir });
            const planDir = findLatestPlanDir(planOut);
            expect(planDir && fs.existsSync(planDir)).toBe(true);
            if (!planDir) throw new Error("planDir not found");
            const { exitCode } = await execa(process.execPath, [
                cli, "run", "--plan-dir", planDir, "--codex-bin", stub, "--max-parallel", "2"
            ], { cwd: dir });
            expect(exitCode).toBe(0);
            const latest = JSON.parse(fs.readFileSync(path.join(planDir, ".runs", "latest.json"), "utf8"));
            const evFile = path.join(latest.runDir, "events.ndjson");
            const text = fs.readFileSync(evFile, "utf8").trim();
            expect(text).toMatch(/"type":"state".*"phase":"start"/s);
            expect(text).toMatch(/"type":"state".*"phase":"exit"/s);
        });
    });
});
