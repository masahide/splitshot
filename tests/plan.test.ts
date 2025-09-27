// tests/plan.test.ts
import { execa } from "execa";
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";


describe("splitshot plan", () => {
    it("prints planDir and creates manifest/checklists", async () => {
        const cliPath = path.resolve("dist/cli/index.js");
        const stub = path.resolve("tests/fixtures/codex-stub.js");

        const { stdout } = await execa(process.execPath, [
            cliPath,
            "plan",
            "--objective",
            "Hello",
            "--workers",
            "2",
            "--codex-bin",
            stub,
        ]);

        const out = JSON.parse(stdout);
        expect(typeof out.planDir).toBe("string");
        // plan-dir 配下の主要ファイルがあること
        expect(fs.existsSync(path.join(out.planDir, "manifest.json"))).toBe(true);
        expect(fs.existsSync(path.join(out.planDir, "checklists", "worker-01.md"))).toBe(true);

    });
});
