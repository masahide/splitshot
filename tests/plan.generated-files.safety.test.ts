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

describe("plan command path safety", () => {
    it("ignores generatedFiles entries that escape the planDir", async () => {
        await withTmp(async ({ dir }) => {
            const env = { ...process.env, PLAN_STUB_UNSAFE_PATH: "../evil.md" };
            const result = await execa(process.execPath, [
                cli,
                "plan",
                "--objective",
                "Safety check",
                "--workers",
                "2",
                "--codex-bin",
                stub,
                "--force-schema",
            ], { cwd: dir, env });
            expect(result.exitCode).toBe(0);

            const planBase = path.join(dir, ".splitshot");
            const planDir = findLatestPlanDir(planBase);
            expect(planDir && fs.existsSync(planDir)).toBe(true);
            if (!planDir) throw new Error("planDir not found");

            const docsIndexPath = path.join(planDir, "docs", "docs.index.json");
            const docsIndex = readJson<{ files: Array<{ path: string; validPath?: boolean; exists: boolean; bytes: number; sha256: string }> }>(
                docsIndexPath
            );
            const unsafeEntry = docsIndex.files.find((f) => f.path === "../evil.md");
            expect(unsafeEntry).toBeTruthy();
            if (!unsafeEntry) throw new Error("unsafe entry missing");
            expect(unsafeEntry.validPath).toBe(false);
            expect(unsafeEntry.exists).toBe(false);
            expect(unsafeEntry.bytes).toBe(0);
            expect(unsafeEntry.sha256).toBe("");

            const outside = path.resolve(planDir, "..", "evil.md");
            expect(fs.existsSync(outside)).toBe(false);
        });
    });
});
