import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs";
import { withTmp } from "./helpers/tmp";

const cli = path.resolve("dist/cli/index.js");
const EXPECTED_FILES = ["agent-ja.md", "if-check.md", "spec.md", "split.md"];

describe("splitshot prompts up", () => {
    it("installs default prompts into the specified Codex home", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
            const codexHome = resolvePath("codex-home");
            await execa(process.execPath, [cli, "prompts", "up", "--home", codexHome], { cwd: dir });
            const promptsDir = path.join(codexHome, "prompts");
            expect(fs.existsSync(promptsDir)).toBe(true);
            const files = fs.readdirSync(promptsDir).sort();
            expect(files).toEqual(EXPECTED_FILES);
            const spec = fs.readFileSync(path.join(promptsDir, "spec.md"), "utf8");
            expect(spec).toContain("SplitShot");

            await execa(process.execPath, [cli, "prompts", "up", "--home", codexHome], { cwd: dir });
            const filesAfter = fs.readdirSync(promptsDir).sort();
            expect(filesAfter).toEqual(EXPECTED_FILES);
        });
    });
});
