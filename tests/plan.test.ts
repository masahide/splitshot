// tests/plan.test.ts
import { execa } from "execa";
import { describe, it, expect } from "vitest";
import path from "node:path";

describe("splitshot plan", () => {
    it("prints Plan JSON", async () => {
        const cliPath = path.resolve("dist/cli/index.js");            // ← ここで定義
        const stub = path.resolve("tests/fixtures/codex-stub.js");    // スタブを使う

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

        const json = JSON.parse(stdout);
        expect(Array.isArray(json.tasks)).toBe(true);
        expect(json.tasks.length).toBeGreaterThan(0);
        expect(json.meta?.workers).toBe(2);
    });
});
