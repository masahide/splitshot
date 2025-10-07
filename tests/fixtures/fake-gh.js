#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const logPath = process.env.FAKE_GH_LOG;
if (logPath) {
    const abs = path.resolve(logPath);
    const records = fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, "utf8")) : [];
    records.push({ args, cwd: process.cwd() });
    fs.writeFileSync(abs, JSON.stringify(records, null, 2));
}
if (args[0] === "pr" && args[1] === "create") {
    process.stdout.write("fake gh pr create\n");
}
process.exit(0);
