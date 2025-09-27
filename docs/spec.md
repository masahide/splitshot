# SplitShot 仕様書（2モード版：プラン / 並列実行）

## 概要

SplitShot は、Codex を用いてソフトウェア開発タスクを **計画（プラン）**し、生成された **チェックリスト（Markdown）** を元に **並列で実行**する CLI ツールです。
ユーザー操作は原則 **2コマンド**のみで完了します。

1. **プランフェーズ**: 目的と並列数を入力すると、並列数ぶんの **TODO チェックリスト（Markdown）** と **マニフェスト** が生成されます。
2. **並列実行フェーズ**: 生成されたチェックリストを単位に Codex を **並列実行**し、状態・ログを収集します（`codex exec --json`）。

---

## ゴール / 非ゴール

* **ゴール**

  * 初見でも迷わない、最小オプションの 2 ステップ運用
  * チェックリスト（人間可読）を中心とした成果物で状況把握が容易
  * 実行の可観測性（状態イベント、標準出力/エラー、JSONL 取り込み）

* **非ゴール**

  * きめ細かい DAG リソース管理（初期版はワーカー内順序保証に限定）
  * Git worktree 作成の実行（コマンド生成は今後の拡張範囲）

---

## 用語

* **プランディレクトリ（plan-dir）**: 1 回のプラン生成で作られるディレクトリ。チェックリストやマニフェスト、実行ログが格納されます。
  既定パス: `./.splitshot/plan-<timestamp>/`
* **チェックリスト**: 各ワーカーが実施する TODO をまとめた Markdown。`checklists/worker-01.md` など。
* **マニフェスト**: 実行時に参照する JSON。チェックリスト一覧やメタ情報を含みます。
* **ラン**: 1 回の並列実行。`<plan-dir>/.runs/<timestamp>/` にイベントログを保存。

---

## CLI

### 1) プランフェーズ

```
splitshot plan \
  --objective <file|text> \
  --workers <N> \
  [--out <dir>] \
  [--codex-bin <path>] \
  [--timeout <ms>]
```

* **必須**

  * `--objective`: 目的文（ファイルパスまたはテキスト）。
  * `--workers`: 並列数（= 生成するチェックリスト数）。
* **任意**

  * `--out`: 出力先ディレクトリ（既定: `./.splitshot/plan-<timestamp>/`）
  * `--codex-bin`: Codex バイナリ（既定: `codex`）
  * `--timeout`: Codex 実行タイムアウト（既定: 120000ms）

**処理内容**

* Codex の `--output-schema` / `--json` 対応を検出（スキップ可）。
* `src/templates/plan.schema.json`（draft 2020-12）に合致する **Plan JSON** を取得・検証。
* Plan のタスクをトポロジー順に **N 本のワーカーストリームへ分配**（ラウンドロビン）。
* 各ストリームごとに **チェックリスト（Markdown）** を生成。
* **マニフェスト（JSON）** を生成。

**出力（plan-dir 配下）**

```
.splitshot/plan-<ts>/
  plan.json                 # Codex から取得・検証済みの計画（内部形式）
  manifest.json             # run が参照するエントリポイント
  plan.prompt.txt           # Codex へ渡したプロンプトのコピー
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
  [--auto-isolate]
```

* **既定**

  * `--plan-dir`: 最新の `./.splitshot/plan-*/` を自動選択
  * `--codex-bin`: `codex`
  * `--max-parallel`: チェックリスト数（`manifest.workers.length`）
  * `--auto-isolate`: 有効（同一 `CODEX_HOME` 検知時に `-iso-<uniq>` 付与）

**処理内容**

* `manifest.json` を読み、`workers[]` を対象に並列実行。
* 各ワーカーについて:

  * `checklists/worker-XX.md` をプロンプトに整形し、
    `codex exec --json -- "<prompt>"` を起動。
  * 実行環境:

    * `cwd = <plan-dir>`
    * `env.CODEX_HOME = <plan-dir>/.homes/<workerId>`（競合時は `-iso-<uniq>` 付与）
    * 追加環境変数:

      * `SPLITSHOT_RUN_ID=<workerId>`
      * `SPLITSHOT_CHECKLIST_FILE=<abs path to md>`
  * ログ収集:

    * `stdout` / `stderr` を行単位で取り込み
    * `$CODEX_HOME/sessions/**/rollout-*.jsonl` を 200ms 間隔で追従（後から出現するファイルも取り込み）
  * 状態管理:

    * `state:start` / `state:exit(code)` を記録
    * 同一ワーカー内で致命的失敗が発生した場合、後続項目を `state:blocked` で記録（将来の詳細化対象）

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

---

### 3) ログ閲覧

```
splitshot tail \
  [--plan-dir <dir>] \
  [--run <id|all>] \
  [--type stdout,stderr,jsonl,state] \
  [--duration <ms>]
```

* 既定で `--plan-dir` の latest run を参照
* `--duration` 指定時は追尾、それ以外は現状出力のみ

---

## 既定値と挙動の要点

* **2コマンド運用**

  * `splitshot plan --objective <...> --workers <N>`
  * `splitshot run`
    これだけで、直近の plan-dir を用いて並列実行まで通ります。
* **成果物の一元化**
  すべて **plan-dir** に集約。中間成果物（チェックリスト、マニフェスト）と、実行結果（events / meta）が一箇所に揃います。
* **Codex 実行**

  * 既定は `codex exec --json` を直接起動。
  * `.js` ランナーを渡す場合は `--codex-bin <path/to/script.js>` を指定すると Node 経由で起動します。
* **CODEX_HOME 衝突**

  * 同一パスが同時使用される場合は起動前に検知。
  * `--auto-isolate` 有効時は自動で `-iso-<uniq>` をサフィックス付与。

---

## データ仕様（抜粋）

* **Plan JSON**: `src/templates/plan.schema.json`（draft 2020-12）
* **Manifest JSON**

  ```ts
  type Manifest = {
    version: 1;
    objective: string;
    createdAt: string; // ISO8601
    workers: { id: string; checklist: string }[];
  }
  ```
* **イベント NDJSON**

  ```ts
  type StateEvent =
    | { type:"state"; runId:string; t:number; data:{ phase:"start" } }
    | { type:"state"; runId:string; t:number; data:{ phase:"exit"; code:number } }
    | { type:"state"; runId:string; t:number; data:{ phase:"blocked"; reason:string; deps?:string[] } };
  type LineEvent =
    | { type:"stdout"|"stderr"|"jsonl"; runId:string; t:number; data:{ line:string } };
  ```

---

## 互換と移行

* 旧 **assign** コマンドは非推奨。2モード化により、チェックリストとマニフェストを中心に運用します。
  互換が必要な場合は、plan-dir を出力先として活用し、将来的に完全移行します。

---

## エラーハンドリング（要点）

* `codex` 非検出 / 非対応: 明確なメッセージ（`--force-schema` 等は将来オプション）
* スキーマ不整合: Ajv で詳細メッセージ
* CODEX_HOME 競合: エラー / `--auto-isolate` の案内
* ファイル欠落（manifest / checklists）: 欠落ファイル名と復旧手順を提示

---

## 開発/テスト（TDD 指針）

* **plan.checklists.test**: チェックリストと manifest の生成を検証
* **run.manifest.e2e.test**: manifest 駆動で N 並列実行し、`events.ndjson` を検証
* **tail.latest.test**: デフォルトで最新ランを追えること
* パフォーマンス: 大量ログ耐性（今後拡張）

---

## 例（最短）

```bash
# 1) プラン
splitshot plan --objective README.md --workers 3

# 2) 実行（最新の plan-dir を自動検出）
splitshot run

# ログ（stdout と jsonl のみ表示）
splitshot tail --type stdout,jsonl
```
