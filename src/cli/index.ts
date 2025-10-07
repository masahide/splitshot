import { createProgram } from "./program.js";

const program = createProgram();

program.parseAsync().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
