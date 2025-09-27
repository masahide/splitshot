import { execa } from "execa";
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const cli = path.resolve("dist/cli/index.js");
const stub = path.resolve("tests/fixtures/codex-stub.js");

function exists(p: string) { return fs.existsSync(p); }

describe("plan phase: plan-dir outputs", () => {
    it("creates plan-dir with plan.json, manifest.json, and N checklists", async () => {
        const { stdout, exitCode } = await execa(process.execPath, [
            cli, "plan",
            "--objective", "Hello SplitShot",
            "--workers", "2",
            "--codex-bin", stub
        ]);
        expect(exitCode).toBe(0);
        const { planDir } = JSON.parse(stdout);
        expect(planDir && typeof planDir === "string").toBe(true);
        expect(exists(path.join(planDir, "plan.json"))).toBe(true);
        expect(exists(path.join(planDir, "plan.prompt.txt"))).toBe(true);
        expect(exists(path.join(planDir, "manifest.json"))).toBe(true);
        expect(exists(path.join(planDir, "checklists", "worker-01.md"))).toBe(true);
        expect(exists(path.join(planDir, "checklists", "worker-02.md"))).toBe(true);
    });
});