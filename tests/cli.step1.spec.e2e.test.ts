import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs";
import { withTmp } from "./helpers/tmp";

const cli = path.resolve("dist/cli/index.js");
const fakeCodex = path.resolve("tests/fixtures/fake-codex.js");

function readJson<T>(file: string): T {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

describe("splitshot step1 spec", () => {
    it("generates docs/spec.md and updates docs index", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
            const queuePath = resolvePath("codex-queue.json");
            const queue = [
                {
                    stdout: JSON.stringify({
                        files: [
                            { path: "docs/spec.md", content: "# Step1 Spec\n\n- generated\n" },
                        ],
                    }),
                },
            ];
            fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));

            const env = {
                ...process.env,
                FAKE_CODEX_BIN: fakeCodex,
                FAKE_CODEX_QUEUE: queuePath,
            };

            fs.mkdirSync(resolvePath("docs"), { recursive: true });
            fs.writeFileSync(resolvePath("docs/spec.objective.md"), "## objective\n", "utf8");

            await execa(process.execPath, [cli, "prompts", "up", "--home", resolvePath(".codex-home")], { cwd: dir, env });

            await execa(process.execPath, [
                cli,
                "step1",
                "spec",
                "--objective",
                "docs/spec.objective.md",
                "--codex-home",
                resolvePath(".codex-home"),
            ], { cwd: dir, env });

            const specPath = resolvePath("docs/spec.md");
            expect(fs.existsSync(specPath)).toBe(true);
            const specContent = fs.readFileSync(specPath, "utf8");
            expect(specContent).toContain("# Step1 Spec");

            const indexPath = resolvePath("docs/docs.index.json");
            expect(fs.existsSync(indexPath)).toBe(true);
            const index = readJson<{ documents: Array<{ path: string; generatedBy: string }> }>(indexPath);
            const entry = index.documents.find((doc) => doc.path === "docs/spec.md");
            expect(entry).toBeTruthy();
            expect(entry?.generatedBy).toBe("step1:spec");
        });
    });
});
