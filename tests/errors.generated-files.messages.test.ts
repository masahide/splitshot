import { describe, it, expect } from "vitest";
import path from "node:path";
import { withTmp } from "./helpers/tmp";
import { cmdPlan } from "../src/cli/plan.js";

const stub = path.resolve("tests/fixtures/codex-plan-writes-files-stub.js");

async function runPlanCommand(args: string[]) {
    const plan = cmdPlan();
    plan.exitOverride();
    await plan.parseAsync(args, { from: "user" });
}

describe("plan command error messaging", () => {
    it("reports when generatedFiles are missing", async () => {
        await withTmp(async ({ dir }) => {
            process.env.PLAN_STUB_DROP_GENERATED_FILES = "1";
            const outDir = path.join(dir, "plan-out");
            const args = [
                "--objective",
                "No files",
                "--workers",
                "1",
                "--codex-bin",
                stub,
                "--force-schema",
                "--out",
                outDir,
            ];
            await expect(runPlanCommand(args)).rejects.toThrow(/generatedFiles/);
            delete process.env.PLAN_STUB_DROP_GENERATED_FILES;
        });
    });

    it("hints when docs index writing fails", async () => {
        await withTmp(async ({ dir }) => {
            process.env.PLAN_STUB_COLLIDE_DOCS = "1";
            const outDir = path.join(dir, "plan-out");
            const args = [
                "--objective",
                "Docs collision",
                "--workers",
                "1",
                "--codex-bin",
                stub,
                "--force-schema",
                "--out",
                outDir,
            ];
            await expect(runPlanCommand(args)).rejects.toThrow(/docs\.index\.json/);
            delete process.env.PLAN_STUB_COLLIDE_DOCS;
        });
    });
});
