#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const queuePath = process.env.FAKE_CODEX_QUEUE;
if (!queuePath) {
    console.error("FAKE_CODEX_QUEUE not set");
    process.exit(1);
}
const absQueue = path.resolve(queuePath);
if (!fs.existsSync(absQueue)) {
    console.error(`queue file not found: ${absQueue}`);
    process.exit(1);
}
let data;
try {
    data = JSON.parse(fs.readFileSync(absQueue, "utf8"));
} catch (err) {
    console.error("failed to parse queue json", err);
    process.exit(1);
}
if (!Array.isArray(data) || data.length === 0) {
    console.error("queue is empty");
    process.exit(1);
}
const next = data.shift();
fs.writeFileSync(absQueue, JSON.stringify(data, null, 2));
if (next.stderr) {
    process.stderr.write(String(next.stderr));
}
if (next.stdout) {
    process.stdout.write(String(next.stdout));
}
const exitCode = typeof next.exitCode === "number" ? next.exitCode : 0;
process.exit(exitCode);
