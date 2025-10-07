import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs";
import { withTmp } from "./helpers/tmp";
import { findLatestPlanDir } from "../src/core/paths.js";

const cli = path.resolve("dist/cli/index.js");
const fakeGit = path.resolve("tests/fixtures/fake-git.js");
const fakeGh = path.resolve("tests/fixtures/fake-gh.js");

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
    if (!planDir) {
        throw new Error("planDir not found");
    }

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
    fs.writeFileSync(path.join(worktreeBaseAbs, "agent-01", "README.md"), "Agent 01 change\n", "utf8");
    fs.writeFileSync(path.join(worktreeBaseAbs, "agent-02", "README.md"), "Agent 02 change\n", "utf8");

    return { planDir, worktreeBaseAbs, worktreeBaseRel: uniqueBase };
}

describe("splitshot integrate", () => {
    it("commits, pushes, and creates a PR via gh", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
            const gitLogPath = resolvePath("git-log.json");
            const ghLogPath = resolvePath("gh-log.json");
            const stdoutPath = resolvePath("integrate-stdout.log");
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                FAKE_GIT_BIN: fakeGit,
                FAKE_GIT_LOG: gitLogPath,
                FAKE_GH_BIN: fakeGh,
                FAKE_GH_LOG: ghLogPath,
                SPLITSHOT_TEST_STDOUT_FILE: stdoutPath,
            };

            const { planDir } = await preparePlanWithWorktrees(dir, resolvePath, env);

            await execa(
                process.execPath,
                [
                    cli,
                    "integrate",
                    "--plan-dir",
                    planDir,
                    "--base",
                    "main",
                    "--title-prefix",
                    "[AI] ",
                ],
                { cwd: dir, env }
            );

            const stdoutCombined = fs.readFileSync(stdoutPath, "utf8");
            expect(stdoutCombined).toContain("gh pr create --base main --head feature/agent-01");

            const gitLog = JSON.parse(fs.readFileSync(gitLogPath, "utf8")) as Array<{
                args: string[];
                cwd: string;
            }>;
            const commitArgs = gitLog.filter((entry) => entry.args.includes("commit"));
            expect(commitArgs).toHaveLength(2);
            expect(commitArgs[0].args.join(" ")).toContain("feature/agent-01");
            expect(commitArgs[1].args.join(" ")).toContain("feature/agent-02");

            const pushArgs = gitLog.filter((entry) => entry.args.includes("push"));
            const pushedBranches = pushArgs.map((entry) => entry.args[entry.args.length - 1]);
            expect(new Set(pushedBranches)).toEqual(new Set(["feature/agent-01", "feature/agent-02"]));

            const ghLog = JSON.parse(fs.readFileSync(ghLogPath, "utf8")) as Array<{ args: string[] }>;
            const last = ghLog.at(-1);
            expect(last?.args.slice(0, 3)).toEqual(["pr", "create", "--base"]);
            expect(last?.args).toContain("--head");
            expect(last?.args).toContain("feature/agent-01");
        });
    });

    it("prints manual instructions when gh is unavailable", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
            const gitLogPath = resolvePath("git-log.json");
            const stdoutPath = resolvePath("integrate-stdout.log");
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                FAKE_GIT_BIN: fakeGit,
                FAKE_GIT_LOG: gitLogPath,
                SPLITSHOT_TEST_STDOUT_FILE: stdoutPath,
            };

            const { planDir } = await preparePlanWithWorktrees(dir, resolvePath, env);

            await execa(
                process.execPath,
                [
                    cli,
                    "integrate",
                    "--plan-dir",
                    planDir,
                    "--base",
                    "develop",
                    "--gh-bin",
                    "gh-not-installed",
                    "--title-prefix",
                    "[AI] ",
                ],
                { cwd: dir, env }
            );

            const stdoutCombined = fs.readFileSync(stdoutPath, "utf8");
            expect(stdoutCombined).toContain("git push origin feature/agent-01");
            expect(stdoutCombined).toContain("gh pr create --base develop --head feature/agent-01");
        });
    });
});
