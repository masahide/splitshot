import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { createPlanDir } from "../core/paths.js";
import { parseTodoMarkdown, type TodoDocument } from "../core/todoParser.js";
import { writeManifestV3 } from "../core/manifest.js";

function toPosix(p: string): string {
    return p.replace(/\\+/g, "/");
}

function ensureFileExists(abs: string, label: string) {
    if (!fs.existsSync(abs)) {
        throw new Error(`${label} が見つかりません: ${abs}`);
    }
    if (!fs.statSync(abs).isFile()) {
        throw new Error(`${label} はファイルではありません: ${abs}`);
    }
}

function ensureDirExists(abs: string, label: string) {
    if (!fs.existsSync(abs)) {
        throw new Error(`${label} が見つかりません: ${abs}`);
    }
    if (!fs.statSync(abs).isDirectory()) {
        throw new Error(`${label} はディレクトリではありません: ${abs}`);
    }
}

function dedupe(items: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of items) {
        const trimmed = item.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        result.push(trimmed);
    }
    return result;
}

function renderChecklist(opts: {
    workerId: string;
    todoRelative: string;
    interfaceRelative: string;
    document: TodoDocument;
}): string {
    const { workerId, todoRelative, interfaceRelative, document } = opts;
    const scopeItems = dedupe(document.scope);
    const testItems = dedupe(document.test);
    const implementItems = dedupe(document.implement);
    const refactorItems = dedupe(document.refactor);
    const checkItems = dedupe(document.checks);

    const lines: string[] = [];
    lines.push(`# Worker ${workerId}`);
    lines.push("");
    lines.push("## コンテキスト");
    lines.push(`- 対応 TODO: ${todoRelative}`);
    lines.push(`- 参照 I/F: ${interfaceRelative}`);
    lines.push("");
    lines.push("## 編集範囲");
    if (scopeItems.length) {
        for (const scope of scopeItems) {
            lines.push(`- ${scope}`);
        }
    } else {
        lines.push("- 編集対象が明記されていないため、変更範囲は最小限に保つ");
    }
    lines.push("");
    lines.push("## 作業手順 (TDD)");
    lines.push("");

    const sections: Array<{ title: string; items: string[]; fallback: string }> = [
        { title: "テスト", items: testItems, fallback: "必要なテストケースを TODO に追記する" },
        { title: "実装", items: implementItems, fallback: "実装手順を TODO に追記する" },
        { title: "リファクタ", items: refactorItems, fallback: "リファクタ方針を TODO に追記する" },
        { title: "機械検証", items: checkItems.length ? checkItems : ["pnpm test"], fallback: "pnpm test" },
    ];

    let order = 1;
    for (const section of sections) {
        lines.push(`### ${order}. ${section.title}`);
        if (section.items.length) {
            for (const item of section.items) {
                lines.push(`- [ ] ${item}`);
            }
        } else {
            lines.push(`- [ ] ${section.fallback}`);
        }
        lines.push("");
        order += 1;
    }

    lines.push(`### ${order}. 完了後`);
    lines.push(`- [ ] ${todoRelative} のチェックボックスを更新する`);

    return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export function cmdStep3(): Command {
    const cmd = new Command("step3");
    cmd.description("Step3 automation commands");

    cmd
        .command("gen-prompts")
        .description("Generate worker checklists from docs/todo/*.md")
        .action(() => {
            try {
                const cwd = process.cwd();
                const docsDir = path.join(cwd, "docs");
                const todoDir = path.join(docsDir, "todo");
                const specPath = path.join(docsDir, "spec.md");
                const interfacePath = path.join(docsDir, "interface.md");

                ensureFileExists(specPath, "docs/spec.md");
                ensureFileExists(interfacePath, "docs/interface.md");
                ensureDirExists(todoDir, "docs/todo");

                const todoFiles = fs
                    .readdirSync(todoDir)
                    .filter((name) => name.toLowerCase().endsWith(".md"))
                    .sort();

                if (todoFiles.length === 0) {
                    throw new Error("docs/todo に TODO ファイル (.md) が見つかりません");
                }

                const planBase = path.join(cwd, ".splitshot");
                const planDir = createPlanDir(planBase);
                const checklistsDir = path.join(planDir, "checklists");
                const homesDir = path.join(planDir, ".homes");
                fs.mkdirSync(checklistsDir, { recursive: true });
                fs.mkdirSync(homesDir, { recursive: true });

                const runsBootstrapDir = path.join(planDir, ".runs", "bootstrap");
                fs.mkdirSync(runsBootstrapDir, { recursive: true });
                const eventsRelative = toPosix(path.join(".runs", "bootstrap", "events.ndjson"));
                fs.writeFileSync(path.join(planDir, eventsRelative), "", "utf8");

                const todoRelPaths: string[] = [];
                const codexHomes: Record<string, string> = {};
                const interfaceRelative = toPosix(path.join("docs", "interface.md"));
                const promptsUsed = ["spec.md", "split.md"];

                todoFiles.forEach((fileName, index) => {
                    const todoAbs = path.join(todoDir, fileName);
                    ensureFileExists(todoAbs, fileName);
                    const markdown = fs.readFileSync(todoAbs, "utf8");
                    const parsed = parseTodoMarkdown(markdown);
                    const workerId = `w${String(index + 1).padStart(2, "0")}`;
                    const checklistName = `worker-${String(index + 1).padStart(2, "0")}.md`;
                    const checklistRelative = toPosix(path.join("checklists", checklistName));
                    const todoRelative = toPosix(path.join("docs", "todo", fileName));
                    const checklistPath = path.join(planDir, checklistRelative);
                    fs.writeFileSync(
                        checklistPath,
                        renderChecklist({
                            workerId,
                            todoRelative,
                            interfaceRelative,
                            document: parsed,
                        }),
                        "utf8"
                    );

                    fs.mkdirSync(path.join(homesDir, workerId), { recursive: true });
                    codexHomes[workerId] = toPosix(path.join(".homes", workerId));
                    todoRelPaths.push(todoRelative);
                });

                const docsIndexPath = path.join(docsDir, "docs.index.json");
                let docsIndexRelative: string | undefined;
                if (fs.existsSync(docsIndexPath)) {
                    docsIndexRelative = toPosix(path.join("docs", "docs.index.json"));
                    const dest = path.join(planDir, docsIndexRelative);
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.copyFileSync(docsIndexPath, dest);
                }

                const manifestPath = path.join(planDir, "manifest.v3.json");
                const manifest = {
                    version: 3 as const,
                    createdAt: new Date().toISOString(),
                    docs: {
                        spec: toPosix(path.join("docs", "spec.md")),
                        interface: interfaceRelative,
                        todos: todoRelPaths,
                        ...(docsIndexRelative ? { index: docsIndexRelative } : {}),
                    },
                    prompts: {
                        sourceHome: ".codex/prompts",
                        used: promptsUsed,
                    },
                    worktrees: {
                        base: ".splitshot/worktrees",
                        branches: [],
                    },
                    run: {
                        maxParallel: todoRelPaths.length,
                        codexHomes,
                        events: eventsRelative,
                    },
                };

                writeManifestV3(manifestPath, manifest);
                console.log(`plan-dir 作成: ${planDir}`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                throw new Error(message);
            }
        });

    return cmd;
}
