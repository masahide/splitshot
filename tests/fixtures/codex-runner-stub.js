#!/usr/bin/env node
// ランナー用スタブ：stdout/stderrを出し、CODEX_HOME/sessions に rollout-*.jsonl を生成
import fs from "node:fs";
import path from "node:path";

const runId = process.env.SPLITSHOT_RUN_ID || "unknown";
const home = process.env.CODEX_HOME || process.cwd();
const force = (process.env.SPLITSHOT_FORCE_FAIL_TASK_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  process.stdout.write(`[${runId}] hello from stdout 1\n`);
  process.stderr.write(`[${runId}] warn from stderr 1\n`);

  const sess = path.join(home, "sessions", `s-${Date.now()}`);
  fs.mkdirSync(sess, { recursive: true });
  const f1 = path.join(sess, "rollout-1.jsonl");
  fs.writeFileSync(f1, JSON.stringify({ runId, step: 1, msg: "start" }) + "\n");

  await sleep(30);
  fs.appendFileSync(f1, JSON.stringify({ runId, step: 2, msg: "mid" }) + "\n");
  process.stdout.write(`[${runId}] hello from stdout 2\n`);

  // 新しいファイルが「後から」現れるケース
  await sleep(30);
  const f2 = path.join(sess, "rollout-2.jsonl");
  fs.writeFileSync(f2, JSON.stringify({ runId, step: 3, msg: "new-file" }) + "\n");
  process.stderr.write(`[${runId}] warn from stderr 2\n`);

  if (force.includes(runId)) {
    process.stderr.write(`[${runId}] forced failure\n`);
    process.exit(1);
    return;
  }
  process.exit(0);
}

await main();