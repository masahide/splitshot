import { Command } from "commander";
import { version, description, name } from "../../package.json";
import { cmdPlan } from "./plan.js";
import { cmdAssign } from "./assign.js";   // ← 追加
import { cmdRun } from "./run.js";

const program = new Command();

program
    .name(name || "splitshot")
    .description(description || "Parallel Codex planner & runner (CLI MVP)")
    .version(version);

program.addCommand(cmdPlan());
program.addCommand(cmdAssign());
program.addCommand(cmdRun());

program.parseAsync().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});

