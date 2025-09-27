# SplitShot 仕様書（2モード版：プラン / 並列実行）

> 最終更新: 2025-09-27

## 概要

SplitShot は、Codex 互換の実行系を用いてソフトウェア開発タスクを **計画（プラン）**し、生成された **チェックリスト（Markdown）** を単位に **並列実行**する CLI ツールです。日常運用は **2コマンド**で完了します。

1. **プラン**: 目的と並列数を入力 → **N本のチェックリスト**と **マニフェスト**を含む **plan-dir** を生成（`./.splitshot/plan-<ts>/`）。
2. **並列実行**: マニフェストを読み取り、各チェックリストを **並列に実行**。状態・標準出力/標準エラー・JSONL を **events.ndjson** に集約。

補助コマンドとして **`splitshot tail`** でログ追尾が可能です。

---

## ゴール / 非ゴール

* **ゴール**

  * 初見でも迷わない、最小オプションの 2 ステップ運用
  * 人間可読な **チェックリスト中心**の成果物で状況把握が容易
  * **可観測性**（状態イベント / stdout / stderr / JSONL 追従 / NDJSON 収集）

* **非ゴール（v1）**

  * きめ細かい DAG リソース管理（初期版はワーカー内順序保証に限定）
  * 自動の `git worktree` 作成（必要ならマニフェストを元に外部スクリプトで対応）

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
.splitshot/plan-<ts>/
  plan.json                 # Codex から取得・検証済みの計画（内部形式）
  manifest.json             # run が参照するエントリポイント
  plan.prompt.txt           # Codex へ渡したプロンプトのコピー
  checklists/
    worker-01.md
    worker-02.md
    ...
  .runs/
    latest.json             # { "runDir": "/abs/path" }
    <run-ts>/
      events.ndjson         # 可観測イベント（NDJSON）
      run.meta.json         # { workers, maxParallel, codexHomes }
  .homes/
    w01/ ... (各ワーカーの CODEX_HOME)
    w02/ ...
```

---

## CLI

### 1) プランフェーズ

```
splitshot plan \
  --objective <file|text> \
  --workers <N> \
  [--codex-bin <path>] \
  [--out <dir>] \
  [--planner-home <dir>]
```

* **必須**

  * `--objective`: 目的文（ファイルパスまたはテキスト）
  * `--workers`: 並列数（= 生成するチェックリスト数）
* **主な任意**

  * `--codex-bin`: Codex バイナリ or JS（既定: `codex`）
  * `--out`: 出力先ディレクトリ（既定: `./.splitshot/plan-<ts>/`）
  * `--planner-home`: プランナーのプロファイル指定

**処理内容**

* Codex の `--output-schema` / `--json` サポートを検出（スキップ可）
* `src/templates/plan.schema.json`（draft 2020‑12）に合致する **Plan JSON** を取得・検証（Ajv 2020）
* Plan のタスクをトポロジー順に **N 本のワーカーストリームへ分配**（ラウンドロビン）
* 各ストリームごとに **チェックリスト（Markdown）** を生成
* **マニフェスト（JSON）** を生成

**標準出力**

* `{ "planDir": "<abs path>" }` を返します

**出力（plan-dir 配下）**

```
.splitshot/plan-<ts>/
  plan.json
  manifest.json
  plan.prompt.txt
  checklists/
    worker-01.md
    worker-02.md
    ...
```

**チェックリストの構成（例）**

```md
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
  "workers": [
    { "id": "w01", "checklist": "checklists/worker-01.md" },
    { "id": "w02", "checklist": "checklists/worker-02.md" }
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
* 各ワーカー:

  * `checklists/worker-XX.md` をプロンプトに整形し、`codex exec --json -- "<prompt>"` を起動
  * 実行環境:

    * `cwd = <plan-dir>`
    * `env.CODEX_HOME = <plan-dir>/.homes/<workerId>`（競合時は `-iso-<uniq>` 付与、テンプレートで上書き可）
    * 追加環境変数:

      * `SPLITSHOT_RUN_ID=<workerId>`
      * `SPLITSHOT_CHECKLIST_FILE=<abs path to md>`
  * ログ収集:

    * `stdout` / `stderr` を行単位で取り込み
    * `$CODEX_HOME/sessions/**/rollout-*.jsonl` を **200ms 間隔で追従**（後から出現するファイルも取り込み）
  * 状態管理:

    * `state:start` / `state:exit(code)` を記録
    * （将来）依存失敗によるスキップ時に `state:blocked` を記録

**出力（plan-dir 配下）**

```
.splitshot/plan-<ts>/
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

  * `splitshot plan --objective <...> --workers <N
