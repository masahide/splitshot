import { execa } from "execa";
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { withTmp } from "./helpers/tmp";
import { findLatestPlanDir } from "../src/core/paths.js";

const cli = path.resolve("dist/cli/index.js");
const stub = path.resolve("tests/fixtures/codex-plan-writes-files-stub.js");

function exists(p: string) {
    return fs.existsSync(p);
}

describe("plan phase: plan-dir outputs", () => {
    it("creates plan-dir artifacts including docs index", async () => {
        await withTmp(async ({ dir }) => {
            const result = await execa(process.execPath, [
                cli,
                "plan",
                "--objective",
                "Hello SplitShot",
                "--workers",
                "2",
                "--codex-bin",
                stub,
                "--force-schema",
            ], { cwd: dir });
            expect(result.exitCode).toBe(0);

            const planBase = path.join(dir, ".splitshot");
            const planDir = findLatestPlanDir(planBase);
            expect(planDir && typeof planDir === "string").toBe(true);
            if (!planDir) throw new Error("planDir not found");

            expect(exists(path.join(planDir, "plan.json"))).toBe(true);
            expect(exists(path.join(planDir, "plan.prompt.txt"))).toBe(true);
            expect(exists(path.join(planDir, "manifest.json"))).toBe(true);
            expect(exists(path.join(planDir, "checklists", "worker-01.md"))).toBe(true);
            expect(exists(path.join(planDir, "checklists", "worker-02.md"))).toBe(true);
            expect(exists(path.join(planDir, "docs", "docs.index.json"))).toBe(true);
        });
    });
});
