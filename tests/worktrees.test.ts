import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs";
import { withTmp } from "./helpers/tmp";
import { findLatestPlanDir } from "../src/core/paths.js";

const cli = path.resolve("dist/cli/index.js");
const fakeGit = path.resolve("tests/fixtures/fake-git.js");

function writeFile(filePath: string, content: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
}

async function runCli(args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) {
    return execa(process.execPath, [cli, ...args], {
        cwd: opts.cwd,
        env: opts.env,
        stdout: "pipe",
        stderr: "pipe",
    });
}

describe("splitshot worktrees", () => {
    async function setupPlan(dir: string, resolvePath: (...segments: string[]) => string) {
        writeFile(resolvePath("docs/spec.md"), "# Spec\n\n- overview\n");
        writeFile(resolvePath("docs/interface.md"), "# Interface\n");
        writeFile(
            resolvePath("docs/todo/agent-a.md"),
            `# Agent A TODO\n\n## 編集範囲\n- src/a/**\n\n### フェーズ: テスト\n- [ ] add tests\n\n### フェーズ: 実装\n- [ ] add impl\n\n### フェーズ: リファクタ\n- [ ] cleanup\n\n### 機械検証\n- [ ] pnpm test\n`
        );
        writeFile(
            resolvePath("docs/todo/agent-b.md"),
            `# Agent B TODO\n\n## 編集範囲\n- src/b/**\n\n### フェーズ: テスト\n- [ ] add tests\n\n### フェーズ: 実装\n- [ ] add impl\n\n### フェーズ: リファクタ\n- [ ] cleanup\n\n### 機械検証\n- [ ] pnpm test\n`
        );

        await runCli(["step3", "gen-prompts"], { cwd: dir, env: process.env });
        const planBase = resolvePath(".splitshot");
        const planDir = findLatestPlanDir(planBase);
        expect(planDir && fs.existsSync(planDir)).toBe(true);
        if (!planDir) throw new Error("planDir not found");
        return planDir;
    }

    it("creates worktrees and updates manifest", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
            const planDir = await setupPlan(dir, resolvePath);
            const logPath = resolvePath("git-log.json");
            const env = {
                ...process.env,
                FAKE_GIT_BIN: fakeGit,
                FAKE_GIT_LOG: logPath,
            };

            await runCli(
                [
                    "worktrees",
                    "up",
                    "--count",
                    "2",
                    "--base",
                    "../worktrees",
                    "--git-bin",
                    fakeGit,
                    "--start-point",
                    "main",
                ],
                { cwd: dir, env }
            );

            const manifestPath = path.join(planDir, "manifest.v3.json");
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
                worktrees: {
                    base: string;
                    branches: Array<{ id: string; branch: string; dir: string }>;
                };
            };

            expect(manifest.worktrees.base).toBe("../worktrees");
            expect(manifest.worktrees.branches).toEqual([
                {
                    id: "w01",
                    branch: "feature/agent-01",
                    dir: "../worktrees/agent-01",
                },
                {
                    id: "w02",
                    branch: "feature/agent-02",
                    dir: "../worktrees/agent-02",
                },
            ]);

            const log = JSON.parse(fs.readFileSync(logPath, "utf8")) as Array<{ args: string[]; cwd: string }>;
            const worktreeAdds = log.filter((entry) => entry.args[0] === "worktree" && entry.args[1] === "add");
            expect(worktreeAdds).toHaveLength(2);
            expect(worktreeAdds[0].args.slice(-3)).toEqual(["-b", "feature/agent-01", "main"]);
            expect(path.isAbsolute(worktreeAdds[0].args[2])).toBe(true);
        });
    });

    it("requires --force when branches are not merged and removes them when forced", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
            const planDir = await setupPlan(dir, resolvePath);
            const logPath = resolvePath("git-log.json");
            const envBase = {
                ...process.env,
                FAKE_GIT_BIN: fakeGit,
                FAKE_GIT_LOG: logPath,
            };

            await runCli(
                [
                    "worktrees",
                    "up",
                    "--count",
                    "2",
                    "--base",
                    "../worktrees",
                    "--git-bin",
                    fakeGit,
                    "--start-point",
                    "main",
                ],
                { cwd: dir, env: envBase }
            );

            await expect(
                runCli(["worktrees", "down"], {
                    cwd: dir,
                    env: { ...envBase, FAKE_GIT_MERGED: "feature/agent-02" },
                })
            ).rejects.toThrowError();

            const manifestBeforeForce = JSON.parse(fs.readFileSync(path.join(planDir, "manifest.v3.json"), "utf8")) as {
                worktrees: { branches: Array<{ branch: string }> };
            };
            expect(manifestBeforeForce.worktrees.branches.map((b) => b.branch)).toEqual([
                "feature/agent-01",
                "feature/agent-02",
            ]);

            await runCli(
                ["worktrees", "down", "--force"],
                { cwd: dir, env: { ...envBase, FAKE_GIT_MERGED: "feature/agent-01,feature/agent-02" } }
            );

            const manifestPath = path.join(planDir, "manifest.v3.json");
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
                worktrees: { branches: unknown[] };
            };
            expect(manifest.worktrees.branches).toEqual([]);

            const log = JSON.parse(fs.readFileSync(logPath, "utf8")) as Array<{ args: string[] }>;
            const removes = log.filter((entry) => entry.args[0] === "worktree" && entry.args[1] === "remove");
            expect(removes).toHaveLength(2);
            const branchDeletes = log.filter((entry) => entry.args[0] === "branch" && entry.args[1] === "-D");
            expect(branchDeletes).toHaveLength(2);
        });
    });
});
