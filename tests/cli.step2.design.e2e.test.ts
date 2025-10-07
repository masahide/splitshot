import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs";
import { withTmp } from "./helpers/tmp";

const cli = path.resolve("dist/cli/index.js");
const fakeCodex = path.resolve("tests/fixtures/fake-codex.js");

describe("splitshot step2 design", () => {
    it("creates interface and todo documents and updates docs index", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
            const queuePath = resolvePath("codex-queue.json");
            const queue = [
                {
                    stdout: JSON.stringify({
                        files: [
                            { path: "docs/interface.md", content: "# Interface\n" },
                            { path: "docs/todo/agent-a.md", content: "- [ ] Task A\n" },
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
            fs.writeFileSync(resolvePath("docs/spec.md"), "# Spec\n", "utf8");

            await execa(process.execPath, [cli, "prompts", "up", "--home", resolvePath(".codex-home")], { cwd: dir, env });

            await execa(process.execPath, [
                cli,
                "step2",
                "design",
                "--codex-home",
                resolvePath(".codex-home"),
            ], { cwd: dir, env });

            expect(fs.readFileSync(resolvePath("docs/interface.md"), "utf8")).toContain("# Interface");
            expect(fs.readFileSync(resolvePath("docs/todo/agent-a.md"), "utf8")).toContain("Task A");

            const docsIndex = JSON.parse(fs.readFileSync(resolvePath("docs/docs.index.json"), "utf8")) as {
                documents: Array<{ path: string }>;
            };
            const paths = docsIndex.documents.map((doc) => doc.path).sort();
            expect(paths).toEqual([
                "docs/interface.md",
                "docs/todo/agent-a.md",
            ]);
        });
    });
});
