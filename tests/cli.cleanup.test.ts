import { describe, it, expect } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { withTmp } from "./helpers/tmp";
import { findLatestPlanDir } from "../src/core/paths.js";

const cli = path.resolve("dist/cli/index.js");
const fakeGit = path.resolve("tests/fixtures/fake-git.js");

function writeFile(filePath: string, content: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
}

async function preparePlanWithWorktrees(
    dir: string,
    resolvePath: (...segments: string[]) => string,
    env: NodeJS.ProcessEnv
) {
    const uniqueBase = `../worktrees-${path.basename(dir)}`;
    writeFile(resolvePath("docs/spec.md"), "# Spec\n");
    writeFile(resolvePath("docs/interface.md"), "# Interface\n");
    writeFile(
        resolvePath("docs/todo/agent-a.md"),
        `# Agent A TODO\n\n## 編集範囲\n- src/a/**\n\n### フェーズ: テスト\n- [ ] add tests\n\n### フェーズ: 実装\n- [ ] add impl\n\n### フェーズ: リファクタ\n- [ ] cleanup\n\n### 機械検証\n- [ ] pnpm test\n`
    );
    writeFile(
        resolvePath("docs/todo/agent-b.md"),
        `# Agent B TODO\n\n## 編集範囲\n- src/b/**\n\n### フェーズ: テスト\n- [ ] add tests\n\n### フェーズ: 実装\n- [ ] add impl\n\n### フェーズ: リファクタ\n- [ ] cleanup\n\n### 機械検証\n- [ ] pnpm test\n`
    );

    await execa(process.execPath, [cli, "step3", "gen-prompts"], { cwd: dir, env: process.env });
    const planBase = resolvePath(".splitshot");
    const planDir = findLatestPlanDir(planBase);
    expect(planDir && fs.existsSync(planDir)).toBe(true);
    if (!planDir) throw new Error("planDir not found");

    await execa(
        process.execPath,
        [
            cli,
            "worktrees",
            "up",
            "--count",
            "2",
            "--base",
            uniqueBase,
            "--git-bin",
            fakeGit,
            "--start-point",
            "main",
        ],
        { cwd: dir, env }
    );

    const worktreeBaseAbs = path.resolve(dir, uniqueBase);
    fs.mkdirSync(path.join(worktreeBaseAbs, "agent-01"), { recursive: true });
    fs.mkdirSync(path.join(worktreeBaseAbs, "agent-02"), { recursive: true });

    return { planDir, worktreeBaseAbs, worktreeBaseRel: uniqueBase };
}

describe("splitshot cleanup", () => {
    it("refuses to delete unmerged branches without --force", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
            const gitLogPath = resolvePath("git-log.json");
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                FAKE_GIT_BIN: fakeGit,
                FAKE_GIT_LOG: gitLogPath,
            };

            const { planDir } = await preparePlanWithWorktrees(dir, resolvePath, env);

            await expect(
                execa(process.execPath, [
                    cli,
                    "cleanup",
                    "--plan-dir",
                    planDir,
                    "--git-bin",
                    fakeGit,
                ], { cwd: dir, env })
            ).rejects.toThrow();

            const manifest = JSON.parse(
                fs.readFileSync(path.join(planDir, "manifest.v3.json"), "utf8")
            ) as { worktrees: { branches: Array<{ branch: string }> } };
            expect(manifest.worktrees.branches).toHaveLength(2);
        });
    });

    it("removes worktrees and branches when --force is provided", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
            const gitLogPath = resolvePath("git-log.json");
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                FAKE_GIT_BIN: fakeGit,
                FAKE_GIT_LOG: gitLogPath,
            };

            const { planDir, worktreeBaseAbs } = await preparePlanWithWorktrees(dir, resolvePath, env);

            await execa(
                process.execPath,
                [
                    cli,
                    "cleanup",
                    "--plan-dir",
                    planDir,
                    "--git-bin",
                    fakeGit,
                    "--force",
                ],
                { cwd: dir, env }
            );

            const manifest = JSON.parse(
                fs.readFileSync(path.join(planDir, "manifest.v3.json"), "utf8")
            ) as { worktrees: { branches: unknown[] } };
            expect(manifest.worktrees.branches).toEqual([]);

            expect(fs.existsSync(path.join(worktreeBaseAbs, "agent-01"))).toBe(false);
            expect(fs.existsSync(path.join(worktreeBaseAbs, "agent-02"))).toBe(false);

            const gitLog = JSON.parse(fs.readFileSync(gitLogPath, "utf8")) as Array<{ args: string[] }>;
            const removes = gitLog.filter((entry) => entry.args[0] === "worktree" && entry.args[1] === "remove");
            expect(removes).toHaveLength(2);
            const branchDeletes = gitLog.filter((entry) => entry.args[0] === "branch" && entry.args[1] === "-D");
            expect(branchDeletes).toHaveLength(2);
        });
    });
});
