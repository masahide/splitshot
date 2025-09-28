import { describe, it, expect } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { withTmp } from "./helpers/tmp";
import { findLatestPlanDir } from "../src/core/paths.js";
import { tailOnce } from "../src/cli/tail.js";


const cli = path.resolve("dist/cli/index.js");
const runner = path.resolve("tests/fixtures/codex-runner-stub.js");
const codexStub = path.resolve("tests/fixtures/codex-plan-writes-files-stub.js");

describe("tail: default latest under plan-dir", () => {
    it("tails latest run when only --plan-dir is given", async () => {
        await withTmp(async ({ dir }) => {
            const planOut = path.join(dir, "plan-out");
            const objectiveSrc = path.join(dir, "objective.txt");
            fs.writeFileSync(objectiveSrc, "tail objective", "utf8");
            await execa(process.execPath, [
                cli,
                "plan",
                "--objective-file",
                objectiveSrc,
                "--workers",
                "1",
                "--codex-bin",
                codexStub,
                "--force-schema",
                "--out",
                planOut,
            ], { cwd: dir });
            const planDir = findLatestPlanDir(planOut);
            expect(planDir && planDir.length > 0).toBe(true);
            if (!planDir) throw new Error("planDir not found");
            await execa(process.execPath, [cli, "run", "--plan-dir", planDir, "--codex-bin", runner], { cwd: dir });

            const latest = JSON.parse(fs.readFileSync(path.join(planDir, ".runs", "latest.json"), "utf8"));
            const eventsFile = path.join(latest.runDir, "events.ndjson");
            const captured = (await tailOnce(eventsFile, "all", new Set(["stdout", "jsonl"]))).join("\n");
            expect(captured.length).toBeGreaterThan(0);
            expect(captured).toMatch(/"type":"jsonl"/);
        });
    });
});
