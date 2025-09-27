以下は　**2モード仕様**に沿って、現行コードからの移行を前提にした **TDD用TODOチェックリスト**です。
各項目は **RED（テスト追加）→ GREEN（実装）→ REFACTOR（整理）** の順で進められる粒度に分けています。
※後方互換は不要とします（旧 `assign` は廃止でOK）。

---

# SplitShot 2モード化：TDD TODOチェックリスト

## 0. 下準備（共通ユーティリティ）

* [ ] **RED**: `tests/helpers/tmp.ts` を用意し、一時ディレクトリ作成/削除のヘルパを追加

  * 期待: `mkTmpWork("splitshot-")` が空ディレクトリを返す
* [ ] **GREEN**: 実装（`tests/helpers/tmp.ts`）
* [ ] **REFACTOR**: 既存E2Eテストの一時ディレクトリ生成をこのヘルパに置換

---

## 1. プランフェーズ：チェックリスト & マニフェスト生成

* [ ] **RED**: `tests/plan.checklists.test.ts` 新規

  * `splitshot plan --objective "Hello" --workers 2` を実行
  * 期待:

    * `./.splitshot/plan-<ts>/plan.json` が存在（`plan.schema.json` に合致）
    * `./.splitshot/plan-<ts>/plan.prompt.txt` が存在
    * `./.splitshot/plan-<ts>/checklists/worker-01.md`, `worker-02.md` が存在
    * `./.splitshot/plan-<ts>/manifest.json` に `version:1`, `workers.length===2`、`checklist` パスが相対で入っている
* [ ] **GREEN**: `src/cli/plan.ts` を拡張

  * 出力基底：`./.splitshot/plan-<timestamp>/`
  * 既存の Plan 生成・Ajv検証は維持
  * 分配ロジック：タスク（トポロジー順）を `workers` 本にラウンドロビンで割当
  * Markdown生成（各ワーカー）：見出し/Context/Tasks（チェックボックス）/Notes
  * `manifest.json` 生成：`{version:1, objective, createdAt, workers:[{id:"w01", checklist:"checklists/worker-01.md"}, …]}`
* [ ] **REFACTOR**: Markdownテンプレートを `src/templates/checklist.md.tpl` に切り出し（将来のカスタムに備える）

---

## 2. 旧 assign の廃止

* [ ] **RED**: `tests/assign.*.test.ts` を削除 or skip（互換不要）
* [ ] **GREEN**: `src/cli/index.ts` から `cmdAssign()` の登録削除、`src/cli/assign.ts` を削除
* [ ] **REFACTOR**: `src/core/git.ts` も削除（参照なくなるため）

---

## 3. run：manifest 駆動で並列実行（plan-dir 基準）

* [ ] **RED**: `tests/run.manifest.e2e.test.ts` 新規

  * 前段で作った plan-dir を使う
  * `splitshot run --plan-dir <that>`（`--codex tests/fixtures/codex-runner-stub.js`）
  * 期待:

    * `<plan-dir>/.runs/latest.json` が存在し、`runDir` が指すディレクトリに `events.ndjson`/`run.meta.json`
    * `events.ndjson` に各ワーカー `w01`, `w02` の `state:start` → `state:exit` が出る
    * `run.meta.json` に `{ workers:["w01","w02"], maxParallel:2, codexHomes:{ w01:…, w02:… } }`
* [ ] **GREEN**: `src/cli/run.ts` を改修

  * オプション：`--plan-dir <dir>`（省略時は `./.splitshot/plan-*` の **最新**を自動解決）
  * `manifest.json` を読み、`workers[]` を対象に並列実行
  * 各ワーカー：

    * `prompt` = `checklists/worker-XX.md` を読み込み、Codexへ渡す本文に整形
    * `cwd = <plan-dir>`
    * `env`：

      * `CODEX_HOME = <plan-dir>/.homes/<workerId>`（重複時は `-iso-<uniq>` 付与；`--auto-isolate` 既定ON）
      * `SPLITSHOT_RUN_ID = <workerId>`
      * `SPLITSHOT_CHECKLIST_FILE = <abs>`
  * ログ収集：既存 runner/tailer を流用し `<plan-dir>/.runs/<ts>/events.ndjson` に出力
  * `<plan-dir>/.runs/latest.json` を更新
* [ ] **REFACTOR**: `src/core/runner.ts` の `spawnCodex` 引数を `taskId` ベースから `worker` ベースに名称調整、`CODEX_HOME` 解決・衝突検知を関数化

---

## 4. run：`--codex-bin` の解釈（ネイティブ or .js）

* [ ] **RED**: `tests/run.codex-bin.script.test.ts` 新規

  * `--codex tests/fixtures/codex-runner-stub.js` で起動
  * 期待: Windows/Unixとも `.js` は `process.execPath` 経由で spawn され `start/exit` が出る
* [ ] **GREEN**: `src/core/runner.ts` の spawn 引数構築を修正

  * `"codex"` の場合はそのまま
  * `*.js` の場合は `command = process.execPath`, `args=[<abs js>, ...extra]`
* [ ] **REFACTOR**: 判定ロジックを `src/core/spawnArgs.ts` に切り出し

---

## 5. tail：plan-dir の latest を既定参照

* [ ] **RED**: `tests/tail.latest.test.ts` 新規

  * `splitshot run` 実行後、`splitshot tail --type stdout,jsonl`（引数なし）で最新 run が読める
* [ ] **GREEN**: `src/cli/tail.ts` 改修

  * 既定で `--plan-dir` の `.runs/latest.json` を読む
  * 手動オプション `--events <file>` は温存（テスト支援）
* [ ] **REFACTOR**: 参照解決をユーティリティ化 `src/core/paths.ts`（`resolveLatestPlanDir()`, `resolveLatestRun()`）

---

## 6. 失敗時の blocked（初期版：ワーカー単位）

* [ ] **RED**: `tests/run.propagation.manifest.e2e.test.ts` 新規

  * `SPLITSHOT_FORCE_FAIL_TASK_IDS="w01"` で `w01` を失敗させる
  * 期待:

    * `w01` は `start`→`exit(code!=0)`
    * 未開始ワーカー（例：`w02`）には `state:blocked` が記録され、実行されない
    * いったん走り出したワーカーは最後まで流す（同時開始のものがあればそのまま完走）
    * プロセス終了コードは非0
* [ ] **GREEN**: `src/core/runner.ts`

  * 任意ワーカーの exit 失敗を検知したら、キュー上の未開始ワーカーを `blocked` にしてスキップ
* [ ] **REFACTOR**: blocked の理由文字列を定数化し、テストで厳密一致

---

## 7. JSONL フォローの堅牢化（新規ファイル追従）

* [ ] **RED**: `tests/run.jsonl.follow.test.ts` 新規

  * ラン中に `$CODEX_HOME/sessions/s-*/rollout-2.jsonl` を作成して追記
  * 期待: `events.ndjson` に jsonl ラインがすべて取り込まれる（欠落なし）
* [ ] **GREEN**: `src/core/tailer.ts` 改修

  * 200ms ポーリングで「最新だけ」でなく「未認識ファイル」を検出して tail 追加
* [ ] **REFACTOR**: ウォッチ対象の index を Map で持ち、読み取り位置を保持

---

## 8. 大量ログ耐性（10万行）

* [ ] **RED**: `tests/run.massive-logs.test.ts` 新規

  * スタブが `stdout` 10万行出力
  * 期待: `events.ndjson` の `stdout` 行数が一致し、欠落なし（実測で 100k 以上）
* [ ] **GREEN**: `src/core/eventsWriter.ts` に `cork()/uncork()`（例：200行ごと）・`drain` 待ちを実装
* [ ] **REFACTOR**: バッファ閾値を `RUN_EVENTS_FLUSH_INTERVAL` として定数化

---

## 9. エラーメッセージ整備

* [ ] **RED**: `tests/errors.messages.test.ts` 新規

  * `codex` 未検出、`manifest.json` 欠落、`checklist` 欠落、`plan-dir` 不在
  * 期待: コマンド名・原因・対処の短文が含まれる
* [ ] **GREEN**: `src/cli/plan.ts` / `src/cli/run.ts` / `src/cli/tail.ts` に対処ヒント付きの例外を実装
* [ ] **REFACTOR**: 共通フォーマッタ `formatCliError(cmd, reason, hint)` を `src/core/errors.ts` に用意

---

## 10. ドキュメントとメタ

* [ ] **RED**: `tests/readme.snippets.test.ts` 新規（任意）

  * README 記載の最短手順（2コマンド）が動くかをスモーク
* [ ] **GREEN**: `README.md` / `README.en.md` を 2モード手順に更新済みのまま維持
* [ ] **REFACTOR**: `package.json` の `bin` 名称・`engines`・`scripts` を現状に合わせ調整（`pnpm check`）

---

# 実装対象ファイルサマリ

* 追加:

  * `tests/plan.checklists.test.ts` / `tests/run.manifest.e2e.test.ts` / `tests/tail.latest.test.ts`
  * `tests/run.propagation.manifest.e2e.test.ts` / `tests/run.jsonl.follow.test.ts` / `tests/run.massive-logs.test.ts`
  * `tests/helpers/tmp.ts`
  * `src/core/paths.ts` / `src/core/errors.ts` / `src/core/eventsWriter.ts`（分離する場合）
  * `src/templates/checklist.md.tpl`
* 変更:

  * `src/cli/plan.ts` / `src/cli/run.ts` / `src/cli/tail.ts`
  * `src/core/runner.ts` / `src/core/tailer.ts`
  * `src/cli/index.ts`（コマンド登録の見直し）
* 削除:

  * `src/cli/assign.ts` / `src/core/git.ts`
  * `tests/assign*.test.ts`

---

# テスト観点（抜粋）

* plan 出力の **構造**（チェックリスト/マニフェスト/プロンプト/Plan JSON）
* run 出力の **配置**（`.runs/latest.json` と `events.ndjson` の整合）
* **並列制御**（`maxParallel` 既定＝workers数、`--max-parallel` 指定で上書き）
* **CODEX_HOME 競合**（自動 isolate のサフィックス付与）
* **ログ完全性**（stdout/stderr/jsonl 各行が欠落しない）
* **失敗時の挙動**（未開始ワーカーの `blocked`、プロセス終了コード非0）
* tail の **デフォルト解決**（plan-dir 最新 run を自動参照）

---

このチェックリストに沿って、各 RED→GREEN→REFACTOR を順に進めれば、2モード仕様へ段階的に移行できます。