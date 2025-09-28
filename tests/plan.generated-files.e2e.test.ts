import { describe, it, expect } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { withTmp } from "./helpers/tmp";
import { findLatestPlanDir } from "../src/core/paths.js";

const cli = path.resolve("dist/cli/index.js");
const stub = path.resolve("tests/fixtures/codex-plan-writes-files-stub.js");

function readJson<T>(p: string): T {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

describe("plan command generated files integration", () => {
    it("writes docs files and docs index metadata", async () => {
        await withTmp(async ({ dir }) => {
            const objectiveSrc = path.join(dir, "objective.txt");
            fs.writeFileSync(objectiveSrc, "Ensure docs objective", "utf8");
            const result = await execa(process.execPath, [
                cli,
                "plan",
                "--objective-file",
                objectiveSrc,
                "--workers",
                "2",
                "--codex-bin",
                stub,
                "--force-schema",
            ], { cwd: dir });
            expect(result.exitCode).toBe(0);

            const planBase = path.join(dir, ".splitshot");
            const planDir = findLatestPlanDir(planBase);
            expect(planDir && fs.existsSync(planDir)).toBe(true);
            if (!planDir) throw new Error("planDir not found");

            const workerTodo = path.join(planDir, "docs", "worker-task", "01", "todo.md");
            const interfaceMd = path.join(planDir, "docs", "interface.md");
            expect(fs.existsSync(workerTodo)).toBe(true);
            expect(fs.existsSync(interfaceMd)).toBe(true);

            const planJson = readJson<{ generatedFiles: Array<{ path: string; role?: string }> }>(
                path.join(planDir, "plan.json")
            );
            const generatedPaths = planJson.generatedFiles.map((f) => f.path);
            expect(generatedPaths).toContain("docs/worker-task/01/todo.md");
            expect(generatedPaths).toContain("docs/interface.md");

            const docsIndexPath = path.join(planDir, "docs", "docs.index.json");
            expect(fs.existsSync(docsIndexPath)).toBe(true);
            const docsIndex = readJson<{ files: Array<{ path: string; exists: boolean; bytes: number; sha256: string }> }>(
                docsIndexPath
            );
            const indexed = Object.fromEntries(docsIndex.files.map((f) => [f.path, f]));
            for (const rel of ["docs/worker-task/01/todo.md", "docs/interface.md"]) {
                const entry = indexed[rel];
                expect(entry, `docs index missing ${rel}`).toBeTruthy();
                expect(entry.exists).toBe(true);
                expect(entry.bytes).toBeGreaterThan(0);
                expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
            }
        });
    });
});
