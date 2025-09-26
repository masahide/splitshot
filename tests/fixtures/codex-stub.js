#!/usr/bin/env node
// 超ミニmal Codexスタブ：--help でフラグを見せ、execでPlan JSONを返す
const args = process.argv.slice(2);

// help: 機能検出用に --output-schema / --json を含めて出力
if (args.includes("--help")) {
  console.log(`
Usage: codex exec [options] -- <prompt>
Options:
  --output-schema <file>
  --json
  --quiet
`);
  process.exit(0);
}

// exec: 構造化JSONを返す
if (args[0] === "exec") {
  // 実際には schema を見ないで固定JSONを返すだけでOK
  const plan = {
    meta: { objective: "stub", workers: 2 },
    tasks: [
      { id: "t1", title: "bootstrap", summary: "init", cwd: ".", prompt: "do something" }
    ]
  };
  process.stdout.write(JSON.stringify(plan));
  process.exit(0);
}

console.error("Unknown invocation:", args.join(" "));
process.exit(1);
