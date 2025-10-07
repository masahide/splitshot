import { describe, it, expect } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { withTmp } from "./helpers/tmp";
import { findLatestPlanDir } from "../src/core/paths.js";

const cli = path.resolve("dist/cli/index.js");
const fakeCodex = path.resolve("tests/fixtures/fake-codex.js");

function writeFile(filePath: string, content: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
}

describe("splitshot run v2", () => {
    it("consumes manifest.v3 and executes worker checklists", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
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

            await execa(process.execPath, [cli, "step3", "gen-prompts"], { cwd: dir });
            const planBase = resolvePath(".splitshot");
            const planDir = findLatestPlanDir(planBase);
            expect(planDir && fs.existsSync(planDir)).toBe(true);
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

            const manifestPath = path.join(planDir, "manifest.v3.json");
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
                run: {
                    maxParallel: number;
                    codexHomes: Record<string, string>;
                    events: string;
                };
            };
            expect(manifest.run.maxParallel).toBe(1);
            expect(Object.keys(manifest.run.codexHomes).sort()).toEqual(["w01", "w02"]);
            expect(manifest.run.events.startsWith(".runs/")).toBe(true);

            const eventsAbs = path.join(planDir, manifest.run.events);
            const eventsLog = fs.readFileSync(eventsAbs, "utf8");
            expect(eventsLog).toMatch(/"runId":"w01"/);
            expect(eventsLog).toMatch(/"runId":"w02"/);

            const latest = JSON.parse(fs.readFileSync(path.join(planDir, ".runs", "latest.json"), "utf8")) as {
                runDir: string;
            };
            expect(fs.existsSync(path.join(latest.runDir, "events.ndjson"))).toBe(true);

            const remainingQueue = JSON.parse(fs.readFileSync(queuePath, "utf8"));
            expect(remainingQueue).toEqual([]);
        });
    });
});
