# SplitShot (CLI MVP)

Codex を並列実行し、**計画 → 割当 → 実行 → ログ収集** を行うミニマルな CLI。
Node.js + TypeScript / ESM / pnpm / tsup / vitest。

## 要件

* Node.js 18 以上
* pnpm

## クイックスタート

```bash
pnpm i
pnpm build
pnpm test
```

スタブだけで動作します。実機 Codex は任意です。

## プロジェクト構成

```
/src
  /cli        plan.ts assign.ts run.ts tail.ts index.ts
  /core       codex.ts planner.ts schema.ts scheduler.ts runner.ts git.ts types.ts
  /templates  plan.schema.json
/tests
  *.test.ts
  /fixtures   codex-stub.js            # plan 用スタブ
             codex-runner-stub.js      # run 用スタブ
```

## できること

* **plan**: Codex `--output-schema` + `--json` で計画を生成し、Ajv 2020-12 で検証
* **assign**: タスクを作業ツリーへ割当。`--codex-home-template` で展開
  拡張: `--worktree-root` / `--auto-worktree` / `--branch-prefix` で **git worktree add コマンドを生成**（実行はしない）
* **run**:

  * `buildBatches` による DAG の層実行
  * `--max-parallel` 並列
  * プロセス起動（`.js` 実行体は `process.execPath` 経由）、`cwd=worktreeDir`、`env.CODEX_HOME` を設定
  * **CODEX_HOME 競合検知** / `--auto-isolate` で `-iso-<uniq>` サフィックス付与
  * `stdout` / `stderr` を行単位で `events.ndjson` に保存
  * `$CODEX_HOME/sessions/**/rollout-*.jsonl` をポーリング取り込み（後出しファイルにも追従）
  * **失敗伝播**: 依存が失敗したタスクは `blocked` として記録
  * 終了コード: いずれか失敗で非 0
* **tail**: `events.ndjson` をフィルタ/フォロー
  `--run <id|all>` / `--type stdout,stderr,jsonl,state` / `--duration <ms>` / `--events <path>`

## データ仕様

### Plan

```ts
type Plan = {
  meta?: { objective?: string; workers?: number };
  tasks: {
    id: string; title: string; summary: string; cwd: string; prompt: string;
    dependsOn?: string[];
    profile?: { model?: string; approval?: "suggest" | "auto" | "full-auto" };
  }[];
}
```

スキーマ: `src/templates/plan.schema.json`（draft 2020-12）

### Assignments

```ts
type Assignments = {
  planId?: string;
  assignments: {
    taskId: string;
    worktreeDir: string;
    codexHome: string;
    profile?: { model?: string; approval?: "suggest" | "auto" | "full-auto" };
  }[];
}
```

### イベント（NDJSON）

```json
{"t":1738020000000,"type":"state","runId":"t1","data":{"phase":"start"}}
{"t":1738020000500,"type":"stdout","runId":"t1","data":{"line":"hello"}}
{"t":1738020001000,"type":"jsonl","runId":"t1","data":{"line":"{\"step\":1}"}}
{"t":1738020001500,"type":"state","runId":"t2","data":{"phase":"blocked","reason":"dependency_failed","deps":["t1"]}}
{"t":1738020002000,"type":"state","runId":"t1","data":{"phase":"exit","code":0}}
```

## CLI 例

### plan

```bash
node dist/cli/index.js plan \
  --objective "Refactor the repo to add SplitShot" \
  --workers 3 \
  --codex-bin tests/fixtures/codex-stub.js \
  > plan.json
```

生成物（プロジェクト直下）: `.codex-parallel/plan-*.json`, `plan.prompt-*.txt`

### assign（手動マップ）

```bash
node dist/cli/index.js assign \
  --plan tests/fixtures/plan-min.json \
  --map t1=../wt1,t2=../wt2 \
  --codex-home-template "<worktreeDir>/.codex-home-<taskId>" \
  > assignments.json
```

### assign（worktree コマンド生成）

```bash
node dist/cli/index.js assign \
  --plan tests/fixtures/plan-min.json \
  --worktree-root ./wts \
  --auto-worktree \
  --branch-prefix splitshot/ \
  --codex-home-template "<worktreeDir>/.codex-home-<taskId>" \
  > assignments.json
```

出力には `git.worktreeAdd[]` が含まれます（実行はしません）。

### run

```bash
node dist/cli/index.js run \
  --plan tests/fixtures/plan-min.json \
  --assignments /tmp/work/assignments.json \
  --codex tests/fixtures/codex-runner-stub.js \
  --max-parallel 2 \
  --auto-isolate
```

出力場所は **assignments.json と同じディレクトリ基準**:

```
<assignmentsDir>/.codex-parallel/
  runs/
    latest.json              # { runDir: "<abs path>" }
    <ts>/
      events.ndjson
      run.meta.json          # { planId?, codexHomes{}, maxParallel }
```

### tail

```bash
node dist/cli/index.js tail --run all --type stdout,jsonl
node dist/cli/index.js tail --run t1  --type stdout --duration 300
node dist/cli/index.js tail --events /path/to/events.ndjson --type state
```

## テスト

```bash
pnpm test
# or
vitest tests/run.e2e.test.ts
```

使用スタブ:

* `tests/fixtures/codex-stub.js`（plan）
* `tests/fixtures/codex-runner-stub.js`（run。`SPLITSHOT_FORCE_FAIL_TASK_IDS="t1,tX"` で任意失敗）

## 実装メモ

* すべて ESM（外部 ESM は拡張子必須。Ajv は `ajv/dist/2020.js`）
* スケジューラ: `buildBatches()` で DAG を層に分解、循環検出
* 並列: セマフォ実装で `--max-parallel` 制御
* jsonl 取り込み: `$CODEX_HOME/sessions/**/rollout-*.jsonl` をポーリング（新規ファイル対応）
* 書き込み: `events.ndjson` は 200 行単位で `cork()/uncork()` を使用
* 起動: `.js` 実行体は `process.execPath` 経由、`cwd=worktreeDir`
* 終了コード: 全成功=0、失敗あり=1


## 貢献

PR / Issue 歓迎。テストは RED → GREEN → REFACTOR の順で追加してください。