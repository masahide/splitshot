import { Command } from "commander";
import { installPromptSet, resolveCodexHome } from "../core/codexPrompts.js";

export function cmdPrompts(): Command {
    const cmd = new Command("prompts");
    cmd.description("Install or update Codex prompt presets");

    cmd
        .command("up")
        .description("Install the default prompt set into CODex home")
        .option("--home <dir>", "Override CODEX_HOME directory")
        .option("--preset <name>", "Prompt preset name", "default")
        .action((opts: { home?: string; preset?: string }) => {
            const home = resolveCodexHome({ home: opts.home });
            installPromptSet(home, opts.preset ?? "default");
            console.log(`prompts installed under ${home}`);
        });

    return cmd;
}
