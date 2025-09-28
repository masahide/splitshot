import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
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
            const outDir = path.join(dir, "plan-out");
            const objectiveSrc = path.join(dir, "objective.txt");
            fs.writeFileSync(objectiveSrc, "No files objective", "utf8");
            const args = [
                "--objective-file",
                objectiveSrc,
                "--workers",
                "1",
                "--codex-bin",
                stub,
                "--out",
                outDir,
            ];
            try {
                process.env.PLAN_STUB_DROP_GENERATED_FILES = "1";
                await expect(runPlanCommand(args)).rejects.toThrow(/generatedFiles/);
            } finally {
                delete process.env.PLAN_STUB_DROP_GENERATED_FILES;
            }
        });
    });

    it("hints when docs index writing fails", async () => {
        await withTmp(async ({ dir }) => {
            const outDir = path.join(dir, "plan-out");
            const objectiveSrc = path.join(dir, "objective.txt");
            fs.writeFileSync(objectiveSrc, "Docs collision objective", "utf8");
            const args = [
                "--objective-file",
                objectiveSrc,
                "--workers",
                "1",
                "--codex-bin",
                stub,
                "--out",
                outDir,
            ];
            try {
                process.env.PLAN_STUB_COLLIDE_DOCS = "1";
                await expect(runPlanCommand(args)).rejects.toThrow(/docs\.index\.json/);
            } finally {
                delete process.env.PLAN_STUB_COLLIDE_DOCS;
            }
        });
    });
});
