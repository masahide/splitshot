import { Command } from "commander";
import { name, version, description } from "../../package.json";
import { cmdPrompts } from "./prompts.js";
import { cmdStep1 } from "./step1.js";
import { cmdStep2 } from "./step2.js";
import { cmdStep3 } from "./step3.js";
import { cmdWorktrees } from "./worktrees.js";
import { cmdIntegrate } from "./integrate.js";
import { cmdCleanup } from "./cleanup.js";
import { cmdRun } from "./run.js";
import { cmdTail } from "./tail.js";

export function createProgram(): Command {
    const program = new Command();
    program
        .name(name || "splitshot")
        .description(description || "SplitShot v2 CLI: prompts, step automation, worktrees, run, integrate, cleanup, tail")
        .version(version);

    program.addCommand(cmdPrompts());
    program.addCommand(cmdStep1());
    program.addCommand(cmdStep2());
    program.addCommand(cmdStep3());
    program.addCommand(cmdWorktrees());
    program.addCommand(cmdIntegrate());
    program.addCommand(cmdCleanup());
    program.addCommand(cmdRun());
    program.addCommand(cmdTail());

    return program;
}
