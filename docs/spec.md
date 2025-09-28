# SplitShot 仕様書（2モード版：プラン / 並列実行）

> 最終更新: 2025-09-27

## 概要

SplitShot は、Codex 互換の実行系を用いてソフトウェア開発タスクを **計画（プラン）** し、生成された **チェックリスト（Markdown）** を単位に **並列実行** する CLI ツールです。日常運用は **2コマンド**で完了します。

1. **プラン**: 目的と並列数を入力 → **N本のチェックリスト**と **マニフェスト**を含む **plan-dir** を生成（`./.splitshot/plan-<ts>/`）。
2. **並列実行**: マニフェストを読み取り、各チェックリストを **並列に実行**。状態・標準出力/標準エラー・JSONL を **`events.ndjson`** に集約。

補助コマンドとして **`splitshot tail`** でログ追尾が可能です。

---

## ゴール / 非ゴール

* **ゴール**

  * 初見でも迷わない、最小オプションの 2 ステップ運用
  * 人間可読な **チェックリスト中心** の成果物で状況把握が容易
  * **可観測性**（状態イベント / stdout / stderr / JSONL 追従 / NDJSON 収集）

* **非ゴール（v1）**

  * きめ細かい DAG リソース管理（初期版はワーカー内順序保証に限定）
  * 自動の git worktree 作成（必要ならマニフェストを元に外部スクリプトで対応）

---

## 用語

* **プランディレクトリ（plan-dir）**: 1 回のプラン生成で作られるディレクトリ。チェックリストやマニフェスト、実行ログが格納されます。
  既定パス: `./.splitshot/plan-<timestamp>/`
* **チェックリスト**: 各ワーカーが実施する TODO をまとめた Markdown（例: `checklists/worker-01.md`）。
* **マニフェスト**: 実行時に参照する JSON。チェックリスト一覧やメタ情報を含みます。
* **ラン**: 1 回の並列実行。`<plan-dir>/.runs/<timestamp>/` にイベントログを保存。

---

## ディレクトリ構成（成果物）

```
.splitshot/
  _schemas/
    plan.schema.zod.json     # Zod→JSON Schema（毎回上書き生成・キャッシュ）
  plan-<ts>/
    plan.json                # Codex から取得・Zodで検証済みの計画（内部形式）
    manifest.json            # run が参照するエントリポイント（docsIndex 付き）
    plan.prompt.txt          # Codex へ渡したプロンプトのコピー
    docs/
      docs.index.json        # 生成ファイルのメタデータ { path, role, workerId, exists, bytes, sha256, validPath }
      interface.md
      worker-task/
        01/todo.md
    checklists/
      worker-01.md
      worker-02.md
      ...
    .runs/
      latest.json            # { "runDir": "/abs/path" }
      <run-ts>/
        events.ndjson        # 可観測イベント（NDJSON）
        run.meta.json        # { workers, maxParallel, codexHomes }
    .homes/
      w01/ ... (各ワーカーの CODEX_HOME)
      w02/ ...
```

> **注**: 旧 `src/templates/plan.schema.json`（手書き JSON Schema）は廃止。スキーマは **`src/templates/plan.zod.ts`** の Zod 定義から **`zod-to-json-schema`** で生成します。

---

## CLI

### 1) プランフェーズ

```
splitshot plan \
  --objective <file|text> \
  --workers <N> \
  [--codex-bin <path>] \
  [--out <dir>] \
  [--planner-home <dir>] \
  [--force-schema]
```

* **必須**

  * `--objective`: 目的文（ファイルパスまたはテキスト）
  * `--workers`: 並列数（= 生成するチェックリスト数）

* **主な任意**

  * `--codex-bin`: Codex バイナリ or JS（既定: `codex`）
  * `--out`: 出力先ディレクトリ（既定: `./.splitshot`）
  * `--planner-home`: プランナー実行用の `CODEX_HOME`（既定: `./.codex-home-planner`）
  * `--force-schema`: Codex の機能検出をスキップして `--output-schema` を強制使用

**処理内容（スキーマ周りが Zod ベースに更新されています）**

* Codex の `--output-schema` / `--output-last-message` / `--json` サポートを検出（`--force-schema` でスキップ可）
* **Zod 定義（`src/templates/plan.zod.ts`）** から **JSON Schema（draft 2020-12）** を生成し、
  `./.splitshot/_schemas/plan.schema.zod.json` へ出力
* 生成した JSON Schema を **Codex** に `--output-schema` で渡して **Plan JSON** を取得（最終メッセージは `--output-last-message` を優先）
* 受信 JSON は **Zod（PlanZ）で厳格検証**（`generatedFiles[]` 必須）
* Plan のタスクをトポロジー順に **N 本のワーカーストリームへ分配**（ラウンドロビン）
* Codex 実行は plan-dir を `--cd` に指定し、`docs/` 配下へ成果物を書かせる
* `generatedFiles[]` の安全性を検証し、`docs/docs.index.json` を生成
* 各ストリームごとに **チェックリスト（Markdown）** を生成
* **マニフェスト（JSON）** を生成（`docsIndex` と各ワーカーの `todo` パスを含む）

**標準出力**

* `{ "planDir": "<abs path>" }` を返します

**出力（plan-dir 配下）**

```
plan.json
manifest.json
plan.prompt.txt
docs/
  docs.index.json
  interface.md
  worker-task/
    01/todo.md
checklists/
  worker-01.md
  worker-02.md
  ...
```

**チェックリストの構成（例）**

```markdown
# Worker 01 — TODO Checklist

## Context
<objective の要約または抜粋>

## Tasks
- [ ] t1: Bootstrap runner
  - Summary: ...
  - Acceptance: ...
- [ ] t3: Tail command
  - Summary: ...
  - Acceptance: ...

## Notes
- 出力は JSONL も含めて行単位でわかるように
- 重要メトリクスは最後に箇条書きで報告
```

**マニフェストの構成（例）**

```json
{
  "version": 1,
  "objective": "<string>",
  "createdAt": "2025-09-27T11:22:33Z",
  "docsIndex": "docs/docs.index.json",
  "workers": [
    {
      "id": "w01",
      "checklist": "checklists/worker-01.md",
      "todo": "docs/worker-task/01/todo.md"
    },
    {
      "id": "w02",
      "checklist": "checklists/worker-02.md",
      "todo": "docs/worker-task/02/todo.md"
    }
  ]
}
```

---

### 2) 並列実行フェーズ

```
splitshot run \
  [--plan-dir <dir>] \
  [--codex-bin <path>] \
  [--max-parallel <N>] \
  [--no-auto-isolate] \
  [--codex-home-template "<planDir>/.homes/<workerId>"]
```

* **既定**

  * `--plan-dir`: 指定なし時は最新の `./.splitshot/plan-*/` を自動選択
  * `--codex-bin`: `codex`
  * `--max-parallel`: `manifest.workers.length`
  * **自動アイソレート有効**: 同一 `CODEX_HOME` を検知すると `-iso-<uniq>` を付与

**処理内容**

* `manifest.json` を読み、`workers[]` を対象に並列実行
* 各ワーカー：

  * `checklists/worker-XX.md` をプロンプトに整形し、`codex exec --json -- "<prompt>"` を起動
  * 実行環境:

    * `cwd = <plan-dir>`
    * `env.CODEX_HOME = <plan-dir>/.homes/<workerId>`（競合時は `-iso-<uniq>` 付与、テンプレートで上書き可）
    * 追加環境変数:

      * `SPLITSHOT_RUN_ID=<workerId>`
      * `SPLITSHOT_CHECKLIST_FILE=<abs path to md>`
  * ログ収集:

    * stdout / stderr を行単位で取り込み
    * `$CODEX_HOME/sessions/**/rollout-*.jsonl` を **200ms 間隔で追従**（後から出現するファイルも取り込み）
  * 状態管理:

    * `state:start` / `state:exit(code)` を記録
    * （将来）依存失敗によるスキップ時に `state:blocked` を記録

**出力（plan-dir 配下）**

```
.runs/
  latest.json              # { "runDir": "<abs path>" }
  <run-ts>/
    events.ndjson
    run.meta.json          # { workers, maxParallel, codexHomes }
.homes/
  w01/ ... (CODEX_HOME)
  w02/ ...
```

**イベント（NDJSON）形式**

```json
{"t": 1738020000000, "type": "state",  "runId": "w01", "data": {"phase": "start"}}
{"t": 1738020000100, "type": "stdout", "runId": "w01", "data": {"line": "..."}}
{"t": 1738020000200, "type": "jsonl",  "runId": "w01", "data": {"line": "{\"step\":1}"}}
{"t": 1738020000300, "type": "state",  "runId": "w01", "data": {"phase": "exit", "code": 0}}
{"t": 1738020000400, "type": "state",  "runId": "w02", "data": {"phase": "blocked", "reason": "dependency_failed"}}
```

**終了コード**

* すべて成功で `0`
* いずれか失敗で `1`

**補足**

* `--codex-bin` が `*.js` の場合は **Node.js（`process.execPath`）経由**で起動
* `--no-auto-isolate` 指定時は、`CODEX_HOME` 競合を検知するとエラーで終了
* `--codex-home-template` で `CODEX_HOME` のパターンを上書き可能（`<planDir>`, `<workerId>` プレースホルダ）

---

### 3) ログ閲覧（tail）

```
splitshot tail \
  [--plan-dir <dir>] \
  [--run <id|all>] \
  [--type stdout,stderr,jsonl,state] \
  [--duration <ms>] \
  [--events <file>]        # テスト/デバッグ用に events.ndjson を直接指定
```

* 既定で `--plan-dir` の **latest run** を参照（未指定時は最新の plan-dir を自動解決）
* `--duration` 指定時は追尾、それ以外は現状出力のみ

---

## 既定値と挙動の要点

* **2コマンド運用**

  * `splitshot plan --objective <...> --workers <N>` → plan-dir 生成
  * `splitshot run [--plan-dir <...>]` → 並列実行（`events.ndjson` 集約）
* **スキーマ管理**

  * **単一ソース（Zod: `src/templates/plan.zod.ts`）**から**型/検証/JSON Schema**を一元化
  * 生成先は `./.splitshot/_schemas/plan.schema.zod.json`（実行毎に上書き生成）
  * 受信 JSON は **Zod で厳格検証**（Ajv は不使用）
* **並列制御**

  * 既定 `max-parallel = workers.length`、CLI で上書き可
* **CODEX_HOME 競合**

  * 既定で **自動アイソレート**（`-iso-<uniq>` サフィックス付与）。明示的に解除可能
* **ログ完全性**

  * stdout / stderr / jsonl を行単位で収集、JSONL は新規ファイル出現も 200ms ポーリングで追従
* **失敗時の挙動**

  * いずれかが失敗するとプロセス終了コードは非 0
    （将来: 未開始ワーカーに `state:blocked` を記録する依存スキップを拡充予定）

---

## 参考（実装の要点）

* スキーマ定義: `src/templates/plan.zod.ts`（`PlanZ`, `TaskZ`, `ProfileZ`）
* スキーマ生成: `zod-to-json-schema` → `./.splitshot/_schemas/plan.schema.zod.json`
* 検証: Zod による `parse`（`ZodError` は整形して CLI に表示）
* スケジューラ: 依存関係からトポロジカル順にレイヤ分解（`buildBatches`）
* イベント出力: `events.ndjson`（軽量 `cork()/uncork()` によるバッファ制御）

以上。
