import { Command } from "commander";
import { version, description, name } from "../../package.json";
import { cmdPlan } from "./plan.js";
import { cmdRun } from "./run.js";
import { cmdTail } from "./tail.js";


const program = new Command();

program
    .name(name || "splitshot")
    .description(description || "Two-mode CLI: plan (checklists+manifest) & run (parallel Codex)")
    .version(version);

program.addCommand(cmdPlan());
program.addCommand(cmdRun());
program.addCommand(cmdTail());

program.parseAsync().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});

