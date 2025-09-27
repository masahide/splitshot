import { Command } from "commander";
import fs from "fs";
import path from "path";
import type { Plan, Assignments, Assignment } from "../core/types";
import { buildAddWorktreeCommand, type WorktreeAddCommand } from "../core/git.js";



function parseMap(map?: string): Record<string, string> {
    if (!map) return {};
    const obj: Record<string, string> = {};
    for (const pair of map.split(",").map(s => s.trim()).filter(Boolean)) {
        const [k, v] = pair.split("=");
        if (!k || !v) throw new Error(`invalid map entry: ${pair}`);
        obj[k] = v;
    }
    return obj;
}

function renderTemplate(tpl: string, vars: Record<string, string>) {
    return tpl
        .replaceAll("<taskId>", vars.taskId ?? "")
        .replaceAll("<worktreeDir>", vars.worktreeDir ?? "");
}

export function cmdAssign() {
    const cmd = new Command("assign");
    cmd
        .description("Create assignments from a plan.json and mapping")
        .option("--plan <file>", "Plan JSON file")
        .option("--map <pairs>", "Mapping like t1=../wt1,t2=../wt2")
        .option("--codex-home-template <tpl>", "Template for CODEX_HOME (use <worktreeDir>,<taskId>)",
            "<worktreeDir>/.codex-home-<taskId>")
        .option("--worktree-root <dir>", "Base directory to create worktrees under")
        .option("--auto-worktree", "Emit git worktree add commands for each assignment", false)
        .option("--branch-prefix <prefix>", "Branch prefix for worktrees", "splitshot/")
        .action(async (opts) => {
            if (!opts.plan) throw new Error("--plan is required");
            const planPath = path.resolve(opts.plan);
            const plan = JSON.parse(fs.readFileSync(planPath, "utf8")) as Plan;

            const m = parseMap(opts.map);
            const asg: Assignments = { assignments: [] };
            const gitCmds: WorktreeAddCommand[] = [];

            for (const t of plan.tasks) {
                // worktreeDir は map を最優先、なければ --worktree-root/<taskId>
                let worktreeDir = m[t.id];
                if (!worktreeDir && opts.worktreeRoot) {
                    worktreeDir = path.resolve(String(opts.worktreeRoot), t.id);
                }
                if (!worktreeDir) throw new Error(`no mapping for taskId=${t.id} (provide --map or --worktree-root)`);
                const codexHome = renderTemplate(opts.codexHomeTemplate, { taskId: t.id, worktreeDir });
                const a: Assignment = {
                    taskId: t.id,
                    worktreeDir,
                    codexHome,
                    profile: t.profile,
                };
                asg.assignments.push(a);
                if (opts.autoWorktree) {
                    const branch = String(opts.branchPrefix ?? "splitshot/") + t.id;
                    const cmd = buildAddWorktreeCommand({
                        gitRoot: process.cwd(),
                        worktreeDir,
                        branch,
                        baseRef: "HEAD",
                        force: false,
                        noCheckout: false,
                    });
                    gitCmds.push(cmd);
                }
            }

            // 保存
            const outDir = path.resolve(".codex-parallel");
            fs.mkdirSync(outDir, { recursive: true });
            const fp = path.join(outDir, `assignments-${Date.now()}.json`);
            fs.writeFileSync(fp, JSON.stringify(asg, null, 2));

            // 画面出力には git コマンドも含める（テスト/可視化用）
            const out: Assignments & { git?: { worktreeAdd: WorktreeAddCommand[] } } = { ...asg };
            if (opts.autoWorktree) out.git = { worktreeAdd: gitCmds };
            process.stdout.write(JSON.stringify(out, null, 2) + "\n");
        });

    return cmd;
}
