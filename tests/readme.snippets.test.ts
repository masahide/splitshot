import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs";
import { withTmp } from "./helpers/tmp";
import { findLatestPlanDir } from "../src/core/paths.js";

const cli = path.resolve("dist/cli/index.js");
const planStub = path.resolve("tests/fixtures/codex-plan-writes-files-stub.js");

describe("README quick start snippets", () => {
    it("runs the plan snippet and produces a plan-dir", async () => {
        await withTmp(async ({ dir }) => {
            const result = await execa(process.execPath, [
                cli,
                "plan",
                "--objective",
                "README.md",
                "--workers",
                "2",
                "--codex-bin",
                planStub,
                "--force-schema",
                "--out",
                path.join(dir, "plan-out"),
            ]);
            expect(result.exitCode).toBe(0);
            const planDir = findLatestPlanDir(path.join(dir, "plan-out"));
            expect(planDir && fs.existsSync(planDir)).toBe(true);
        });
    });
});
