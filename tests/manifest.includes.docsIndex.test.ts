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

describe("manifest docs index integration", () => {
    it("includes docsIndex and worker todo paths", async () => {
        await withTmp(async ({ dir }) => {
            const objectivePath = path.join(dir, "objective.md");
            fs.writeFileSync(objectivePath, "Manifest objective", "utf8");
            const result = await execa(process.execPath, [
                cli,
                "plan",
                "--objective-file",
                "objective.md",
                "--workers",
                "2",
                "--codex-bin",
                stub,
            ], { cwd: dir });
            expect(result.exitCode).toBe(0);

            const planDir = findLatestPlanDir(path.join(dir, ".splitshot"));
            expect(planDir && fs.existsSync(planDir)).toBe(true);
            if (!planDir) throw new Error("planDir not found");

            const manifest = readJson<{
                docsIndex?: string;
                objective: { outputFile: string };
                workers: Array<{ id: string; checklist: string; todo?: string }>;
            }>(path.join(planDir, "manifest.json"));
            expect(manifest.docsIndex).toBe("docs/docs.index.json");
            expect(manifest.objective.outputFile).toBe("objective.md");
            const todos = manifest.workers.map((w) => w.todo);
            expect(todos).toContain("docs/worker-task/01/todo.md");
        });
    });
});
