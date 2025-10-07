#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const logPath = process.env.FAKE_GIT_LOG;
if (logPath) {
    const abs = path.resolve(logPath);
    const records = fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, "utf8")) : [];
    records.push({ args, cwd: process.cwd() });
    fs.writeFileSync(abs, JSON.stringify(records, null, 2));
}
if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") {
    process.stdout.write("fake-branch\n");
    process.exit(0);
}

if (args[0] === "branch" && args[1] === "--merged") {
    const mergedEnv = process.env.FAKE_GIT_MERGED ?? "";
    if (mergedEnv.trim()) {
        const lines = mergedEnv
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean)
            .map((name) => `  ${name}`)
            .join("\n");
        process.stdout.write(`${lines}\n`);
    }
    process.exit(0);
}

process.exit(0);
