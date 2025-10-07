import { describe, it, expect } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { withTmp } from "./helpers/tmp";
import { findLatestPlanDir } from "../src/core/paths.js";

const cli = path.resolve("dist/cli/index.js");

function writeFile(filePath: string, content: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
}

describe("splitshot step3 gen-prompts", () => {
    it("parses todo files and creates TDD-ordered worker prompts with manifest v3", async () => {
        await withTmp(async ({ dir, path: resolvePath }) => {
            writeFile(resolvePath("docs/spec.md"), "# Spec\n\n- overview\n");
            writeFile(resolvePath("docs/interface.md"), "# Interface\n\n- api contract\n");
            writeFile(
                resolvePath("docs/docs.index.json"),
                JSON.stringify(
                    {
                        documents: [
                            { path: "docs/spec.md", generatedBy: "step1:spec", updatedAt: new Date().toISOString() },
                            { path: "docs/interface.md", generatedBy: "step2:design", updatedAt: new Date().toISOString() },
                        ],
                    },
                    null,
                    2
                ) + "\n"
            );

            writeFile(
                resolvePath("docs/todo/agent-a.md"),
                `# Agent A TODO\n\n## 編集範囲\n- src/feature/alpha/**\n- tests/feature/alpha/**\n\n### フェーズ: テスト\n- [ ] 失敗するユニットテストを追加\n- [ ] API コントラクトケースを追加\n\n### フェーズ: 実装\n- [ ] リポジトリ層にメソッドを追加\n\n### フェーズ: リファクタ\n- [ ] 重複ロジックを共通化\n\n### 機械検証\n- [ ] pnpm test\n- [ ] pnpm lint\n`
            );

            writeFile(
                resolvePath("docs/todo/agent-b.md"),
                `# Agent B TODO\n\n## 編集範囲\n- src/feature/beta/**\n\n### フェーズ: テスト\n- [ ] 統合テストを追加\n\n### フェーズ: 実装\n- [ ] CLI に新しいフラグを実装\n\n### フェーズ: リファクタ\n- [ ] 古いユーティリティを削除\n\n### 機械検証\n- [ ] pnpm test\n- [ ] pnpm typecheck\n`
            );

            await execa(process.execPath, [cli, "step3", "gen-prompts"], { cwd: dir, env: process.env });

            const planBase = resolvePath(".splitshot");
            const planDir = findLatestPlanDir(planBase);
            expect(planDir && fs.existsSync(planDir)).toBe(true);
            if (!planDir) throw new Error("planDir not found");

            const manifestPath = path.join(planDir, "manifest.v3.json");
            expect(fs.existsSync(manifestPath)).toBe(true);
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
                version: number;
                docs: { spec: string; interface: string; todos: string[]; index?: string };
                prompts: { sourceHome: string };
                worktrees: { base: string; branches: Array<unknown> };
                run: { maxParallel: number; codexHomes: Record<string, string>; events: string };
            };

            expect(manifest.version).toBe(3);
            expect(manifest.docs.spec).toBe("docs/spec.md");
            expect(manifest.docs.interface).toBe("docs/interface.md");
            expect(manifest.docs.todos).toEqual([
                "docs/todo/agent-a.md",
                "docs/todo/agent-b.md",
            ]);
            expect(manifest.docs.index).toBe("docs/docs.index.json");
            expect(manifest.prompts.sourceHome).toBe(".codex/prompts");
            expect(manifest.worktrees.base).toBe(".splitshot/worktrees");
            expect(manifest.worktrees.branches).toEqual([]);
            expect(manifest.run.maxParallel).toBe(2);
            expect(manifest.run.codexHomes).toEqual({ w01: ".homes/w01", w02: ".homes/w02" });
            const eventsPath = path.join(planDir, manifest.run.events);
            expect(fs.existsSync(eventsPath)).toBe(true);

            const worker1Path = path.join(planDir, "checklists", "worker-01.md");
            const worker2Path = path.join(planDir, "checklists", "worker-02.md");
            expect(fs.existsSync(worker1Path)).toBe(true);
            expect(fs.existsSync(worker2Path)).toBe(true);

            const worker1 = fs.readFileSync(worker1Path, "utf8");
            const worker2 = fs.readFileSync(worker2Path, "utf8");

            expect(worker1).toContain("# Worker w01");
            expect(worker1).toContain("src/feature/alpha/**");
            expect(worker1.indexOf("失敗するユニットテスト")).toBeLessThan(
                worker1.indexOf("リポジトリ層にメソッドを追加")
            );
            expect(worker1.trim().endsWith("docs/todo/agent-a.md のチェックボックスを更新する"))
                .toBe(true);
            expect(worker1).toMatch(/### 4\. 機械検証[\s\S]*pnpm test[\s\S]*pnpm lint/);

            expect(worker2).toContain("# Worker w02");
            expect(worker2).toContain("src/feature/beta/**");
            expect(worker2).toMatch(/pnpm test[\s\S]*pnpm typecheck/);

            expect(fs.existsSync(path.join(planDir, ".homes", "w01"))).toBe(true);
            expect(fs.existsSync(path.join(planDir, ".homes", "w02"))).toBe(true);
        });
    });
});
