import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";

const cli = path.resolve("dist/cli/index.js");

describe("legacy commands removed", () => {
    it("fails when invoking removed plan command", async () => {
        const { exitCode } = await execa(process.execPath, [cli, "plan"], {
            reject: false,
        });
        expect(exitCode).not.toBe(0);
    });
});
