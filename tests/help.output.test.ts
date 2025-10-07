import { describe, it, expect } from "vitest";
import { createProgram } from "../src/cli/program.js";

function findSubcommand(cmdName: string) {
    const program = createProgram();
    const command = program.commands.find((cmd) => cmd.name() === cmdName || cmd.aliases().includes(cmdName));
    if (!command) {
        throw new Error(`Command ${cmdName} not found`);
    }
    return command;
}

describe("help output", () => {
    it("lists v2 commands in the top-level help", () => {
        const program = createProgram();
        const help = program.helpInformation();
        const expectedCommands = [
            "prompts",
            "step1",
            "step2",
            "step3",
            "worktrees",
            "run",
            "integrate",
            "cleanup",
            "tail",
        ];
        for (const name of expectedCommands) {
            const pattern = new RegExp(String.raw`\n\s*${name}\b`);
            expect(help).toMatch(pattern);
        }
        expect(help).not.toContain("plan");
    });

    it("shows step1 spec options", () => {
        const step1 = findSubcommand("step1");
        const spec = step1.commands.find((cmd) => cmd.name() === "spec");
        expect(spec).toBeTruthy();
        const help = spec!.helpInformation();
        expect(help).toContain("--objective <file>");
        expect(help).toContain("--codex-home");
        expect(help).toContain("Generate docs/spec.md");
    });

    it("shows run options", () => {
        const run = findSubcommand("run");
        const help = run.helpInformation();
        expect(help).toContain("--plan-dir <dir>");
        expect(help).toContain("--max-parallel <n>");
        expect(help).toContain("--create-worktrees");
    });
});
