import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import { withTmp } from "./helpers/tmp";


const cli = path.resolve("dist/cli/index.js");
const runner = path.resolve("tests/fixtures/codex-runner-stub.js");
const codexStub = path.resolve("tests/fixtures/codex-stub.js");

describe("tail: default latest under plan-dir", () => {
    it("tails latest run when only --plan-dir is given", async () => {
        await withTmp(async ({ dir }) => {
            const planRes = await execa(process.execPath, [cli, "plan", "--objective", "tail-check", "--workers", "1", "--codex-bin", codexStub], { cwd: dir });
            const { planDir } = JSON.parse(planRes.stdout);
            await execa(process.execPath, [cli, "run", "--plan-dir", planDir, "--codex-bin", runner], { cwd: dir });
            const { stdout, exitCode } = await execa(process.execPath, [
                cli, "tail",
                "--plan-dir", planDir,
                "--type", "stdout,jsonl"
            ], { cwd: dir });
            expect(exitCode).toBe(0);
            expect(stdout).toMatch(/"type":"stdout"/);
            expect(stdout).toMatch(/"type":"jsonl"/);
        });
    });
});