import { describe, it, expect } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { withTmp } from "./helpers/tmp";
import { findLatestPlanDir } from "../src/core/paths.js";
import { tailOnce } from "../src/cli/tail.js";

const cli = path.resolve("dist/cli/index.js");
const fakeCodex = path.resolve("tests/fixtures/fake-codex.js");

type SetupResult = {
    planDir: string;
    eventsFile: string;
};

function writeFile(filePath: string, content: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
}

async function setupPlanAndRun(dir: string, resolvePath: (...segments: string[]) => string): Promise<SetupResult> {
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
    if (!planDir) throw new Error("planDir not found");

    const queuePath = resolvePath("codex-queue.json");
    const queue = [
        { stdout: "worker w01 done\n" },
        { stdout: "worker w02 done\n" },
    ];
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));

    const env = {
        ...process.env,
        FAKE_CODEX_BIN: fakeCodex,
        FAKE_CODEX_QUEUE: queuePath,
    };

    await execa(
        process.execPath,
        [
            cli,
            "run",
            "--plan-dir",
            planDir,
            "--codex-bin",
            fakeCodex,
            "--max-parallel",
            "1",
            "--jsonl-interval",
            "10",
        ],
        { cwd: dir, env }
    );

    const latest = JSON.parse(fs.readFileSync(path.join(planDir, ".runs", "latest.json"), "utf8")) as {
        runDir: string;
    };
    const eventsFile = path.join(latest.runDir, "events.ndjson");
    return { planDir, eventsFile };
}

describe("splitshot tail v2", () => {
    it("prints state events when filtering by type", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
            const { eventsFile } = await setupPlanAndRun(dir, resolvePath);
            const manualLines = (await tailOnce(eventsFile, "all", new Set(["state"])));
            expect(manualLines.length).toBeGreaterThan(0);
            const result = await execa(process.execPath, [
                cli,
                "tail",
                "--events",
                eventsFile,
                "--type",
                "state",
                "--run",
                "all",
            ], { cwd: dir });
            expect(result.exitCode).toBe(0);
            expect(manualLines.join("\n")).toContain('"type":"state"');
            expect(manualLines.join("\n")).toContain('"runId":"w01"');
        });
    });

    it("filters by run id", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
            const { eventsFile } = await setupPlanAndRun(dir, resolvePath);
            const manualLines = await tailOnce(eventsFile, "w02", new Set(["state"]));
            expect(manualLines.length).toBeGreaterThan(0);
            const result = await execa(process.execPath, [
                cli,
                "tail",
                "--events",
                eventsFile,
                "--type",
                "state",
                "--run",
                "w02",
            ], { cwd: dir });
            expect(result.exitCode).toBe(0);
            expect(manualLines.join("\n")).toContain('"runId":"w02"');
        });
    });
});
