import { describe, it, expect } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { withTmp } from "./helpers/tmp";

const stub = path.resolve("tests/fixtures/codex-plan-writes-files-stub.js");

function ensureFiles(planDir: string, generatedFiles: Array<{ path: string }>) {
    const required = new Set(["docs/worker-task/01/todo.md", "docs/interface.md"]);
    const seen = new Set(generatedFiles.map((f) => f.path));
    for (const rel of required) {
        expect(seen.has(rel)).toBe(true);
        const abs = path.join(planDir, rel);
        expect(fs.existsSync(abs)).toBe(true);
    }
}

describe("codex-plan-writes-files-stub", () => {
    it("writes worker docs and emits generatedFiles via stdout", async () => {
        await withTmp(async ({ dir, path: tmpPath }) => {
            const planDir = tmpPath("plan");
            fs.mkdirSync(planDir, { recursive: true });
            const schemaPath = tmpPath("schema.json");
            fs.writeFileSync(schemaPath, "{}");
            const result = await execa(process.execPath, [
                stub,
                "exec",
                "--output-schema",
                schemaPath,
                "--cd",
                planDir,
                "--sandbox",
                "workspace-write",
                "--skip-git-repo-check",
                "--",
                "dummy prompt"
            ], { cwd: dir });
            expect(result.exitCode).toBe(0);
            const fallbackPath = path.join(planDir, "plan.stub.json");
            const source = result.stdout.trim() || fs.readFileSync(fallbackPath, "utf8");
            const json = JSON.parse(source);
            expect(Array.isArray(json.generatedFiles)).toBe(true);
            expect(json.generatedFiles.length).toBeGreaterThan(0);
            ensureFiles(planDir, json.generatedFiles);
        });
    });

    it("prefers --output-last-message when provided", async () => {
        await withTmp(async ({ dir, path: tmpPath }) => {
            const planDir = tmpPath("plan");
            fs.mkdirSync(planDir, { recursive: true });
            const schemaPath = tmpPath("schema.json");
            fs.writeFileSync(schemaPath, "{}");
            const lastMessagePath = tmpPath("last-message.json");
            const result = await execa(process.execPath, [
                stub,
                "exec",
                "--output-schema",
                schemaPath,
                "--output-last-message",
                lastMessagePath,
                "--cd",
                planDir,
                "--sandbox",
                "workspace-write",
                "--skip-git-repo-check",
                "--",
                "dummy prompt"
            ], { cwd: dir });
            expect(result.exitCode).toBe(0);
            expect(result.stdout.trim()).toBe("");
            expect(fs.existsSync(lastMessagePath)).toBe(true);
            const json = JSON.parse(fs.readFileSync(lastMessagePath, "utf8"));
            expect(Array.isArray(json.generatedFiles)).toBe(true);
            expect(json.generatedFiles.length).toBeGreaterThan(0);
            ensureFiles(planDir, json.generatedFiles);
        });
    });
});
