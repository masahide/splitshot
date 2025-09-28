// tests/plan.test.ts
import { execa } from "execa";
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { withTmp } from "./helpers/tmp";
import { findLatestPlanDir } from "../src/core/paths.js";

describe("splitshot plan", () => {
    it("creates planDir with manifest, checklists, and generated docs index", async () => {
        const cliPath = path.resolve("dist/cli/index.js");
        const stub = path.resolve("tests/fixtures/codex-plan-writes-files-stub.js");
        await withTmp(async ({ dir }) => {
            const objectivePath = path.join(dir, "objective.txt");
            fs.writeFileSync(objectivePath, "Hello objective", "utf8");
            const result = await execa(process.execPath, [
                cliPath,
                "plan",
                "--objective-file",
                "objective.txt",
                "--workers",
                "2",
                "--codex-bin",
                stub,
            ], { cwd: dir });
            expect(result.exitCode).toBe(0);

            const planBase = path.join(dir, ".splitshot");
            const planDir = findLatestPlanDir(planBase);
            expect(planDir && fs.existsSync(planDir)).toBe(true);
            if (!planDir) throw new Error("planDir not found");

            const manifestPath = path.join(planDir, "manifest.json");
            expect(fs.existsSync(manifestPath)).toBe(true);
            expect(fs.existsSync(path.join(planDir, "checklists", "worker-01.md"))).toBe(true);

            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            expect(manifest.objective).toBeDefined();
            expect(manifest.objective.outputFile).toBe("objective.txt");
            const objectiveCopy = path.join(dir, manifest.objective.outputFile);
            expect(fs.readFileSync(objectiveCopy, "utf8")).toBe("Hello objective");

            const planJson = JSON.parse(fs.readFileSync(path.join(planDir, "plan.json"), "utf8"));
            expect(Array.isArray(planJson.generatedFiles)).toBe(true);
            expect(planJson.generatedFiles.length).toBeGreaterThan(0);

            const docsIndexPath = path.join(planDir, "docs", "docs.index.json");
            expect(fs.existsSync(docsIndexPath)).toBe(true);
            const docsIndex = JSON.parse(fs.readFileSync(docsIndexPath, "utf8"));
            expect(Array.isArray(docsIndex.files)).toBe(true);
        });
    });
});
