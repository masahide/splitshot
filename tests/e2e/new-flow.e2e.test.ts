import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs";
import { withTmp } from "../helpers/tmp";

const cli = path.resolve("dist/cli/index.js");
const fakeCodex = path.resolve("tests/fixtures/fake-codex.js");
const fakeGit = path.resolve("tests/fixtures/fake-git.js");
const fakeGh = path.resolve("tests/fixtures/fake-gh.js");

type RunEnv = NodeJS.ProcessEnv & {
    FAKE_CODEX_BIN: string;
    FAKE_CODEX_QUEUE: string;
    FAKE_GIT_BIN: string;
    FAKE_GH_BIN: string;
    FAKE_GIT_LOG?: string;
    FAKE_GH_LOG?: string;
};

async function runCli(args: string[], opts: { cwd: string; env: RunEnv }) {
    return execa(process.execPath, [cli, ...args], {
        cwd: opts.cwd,
        env: opts.env,
        stdout: "pipe",
        stderr: "pipe",
    });
}

function findLatestPlanDir(base: string): string | null {
    if (!fs.existsSync(base)) return null;
    const entries = fs
        .readdirSync(base)
        .filter((name) => name.startsWith("plan-"))
        .map((name) => ({
            name,
            full: path.join(base, name),
            stat: fs.statSync(path.join(base, name)),
        }))
        .filter((entry) => entry.stat.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));
    return entries.at(-1)?.full ?? null;
}

describe("new v2 flow e2e", () => {
    it("prompts→step1→step2→step3→worktrees→run→integrate→cleanup", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
            const queuePath = resolvePath("codex-queue.json");
            const codexQueue = [
                {
                    stdout: JSON.stringify({
                        files: [
                            { path: "docs/spec.md", content: "# Spec Doc\n\n- goal\n" },
                        ],
                    }),
                },
                {
                    stdout: JSON.stringify({
                        files: [
                            { path: "docs/interface.md", content: "# Interface\n\n- endpoint\n" },
                            { path: "docs/todo/agent-a.md", content: "# Agent A TODO\n\n- [ ] Task A\n" },
                        ],
                    }),
                },
                {
                    stdout: JSON.stringify({
                        events: [
                            { type: "summary", text: "worker done" },
                        ],
                    }),
                },
            ];
            fs.writeFileSync(queuePath, JSON.stringify(codexQueue, null, 2));

            fs.mkdirSync(resolvePath("docs"), { recursive: true });
            fs.writeFileSync(resolvePath("docs/spec.objective.md"), "## objective\n", "utf8");

           const env: RunEnv = {
                ...process.env,
                FAKE_CODEX_BIN: fakeCodex,
                FAKE_CODEX_QUEUE: queuePath,
                FAKE_GIT_BIN: fakeGit,
                FAKE_GH_BIN: fakeGh,
                FAKE_GIT_LOG: resolvePath("fake-git-log.json"),
                FAKE_GH_LOG: resolvePath("fake-gh-log.json"),
                CODEX_HOME: resolvePath(".codex-home"),
                SPLITSHOT_TEST_STDOUT_FILE: resolvePath("integrate-output.log"),
            };

            const worktreeBaseRel = "../worktrees-e2e";
            const worktreeBaseAbs = path.resolve(dir, worktreeBaseRel);

            await runCli(["prompts", "up", "--home", resolvePath(".codex-home")], { cwd: dir, env });

            await runCli(["step1", "spec", "--objective", "docs/spec.objective.md"], { cwd: dir, env });
            expect(fs.existsSync(resolvePath("docs/spec.md"))).toBe(true);

            await runCli(["step2", "design"], { cwd: dir, env });
            expect(fs.existsSync(resolvePath("docs/interface.md"))).toBe(true);
            expect(fs.existsSync(resolvePath("docs/todo/agent-a.md"))).toBe(true);

            await runCli(["step3", "gen-prompts"], { cwd: dir, env });
            const planDir = findLatestPlanDir(resolvePath(".splitshot"));
            expect(planDir && fs.existsSync(path.join(planDir, "manifest.v3.json"))).toBe(true);

            await runCli(["worktrees", "up", "--count", "1", "--base", worktreeBaseRel], { cwd: dir, env });
            fs.mkdirSync(path.join(worktreeBaseAbs, "agent-01"), { recursive: true });
            expect(fs.existsSync(path.join(worktreeBaseAbs, "agent-01"))).toBe(true);

            await runCli(["run", "--max-parallel", "1"], { cwd: dir, env });
            const manifestPath = path.join(planDir ?? "", "manifest.v3.json");
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            const runEvents = manifest.run?.events;
            expect(runEvents).toMatch(/events\.ndjson$/);
            const eventsPath = path.join(planDir ?? "", runEvents ?? "");
            expect(fs.existsSync(eventsPath)).toBe(true);

            await runCli(["integrate"], { cwd: dir, env });
            const integrateOutput = fs.readFileSync(resolvePath("integrate-output.log"), "utf8");
            expect(integrateOutput).toContain("gh pr create --base main --head feature/agent-01");

            await runCli(["cleanup", "--force"], { cwd: dir, env });
            expect(fs.existsSync(path.join(worktreeBaseAbs, "agent-01"))).toBe(false);
        });
    });
});
