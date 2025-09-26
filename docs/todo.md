いい感じに進んでます！いまのコードとセットアップ状況から見た**進捗＆残タスクのチェックリスト**をまとめました（私見を含みます）。

---

# 現在の進捗 ✅

* [x] プロジェクト雛形（Node 18+/ESM, pnpm）
* [x] ビルド：`tsup`（ESM, shebang）／`package.json` の `bin` 配線
* [x] Lint：ESLint v9 フラット構成（`eslint.config.js`）＋ Prettier
* [x] 型チェック：`tsconfig.typecheck.json` ＋ `pnpm typecheck`
* [x] テスト：Vitest（`pnpm test`）、`pretest` でビルド
* [x] Codex スタブ実装（`tests/fixtures/codex-stub.js`）＆テストで使用
* [x] `plan` コマンド実装

  * [x] `--output-schema` / `--json` 検出（`help`/`exec --help`/stderr も考慮）
  * [x] `--force-schema` で検出スキップ
  * [x] プロンプト生成（Plan Assist）
  * [x] Ajv **2020-12** で Schema 検証（`ajv/dist/2020.js`）
  * [x] 生成物保存：`.codex-parallel/plan-*.json` & `plan.prompt-*.txt`
* [x] 型・ユーティリティ

  * [x] `src/core/types.ts`（Plan/TaskSpec）
  * [x] `src/templates/plan.schema.json`
  * [x] `src/core/{codex.ts, planner.ts, schema.ts}`

---

# フェーズ1（CLI版MVP）で**必須**の残タスク 🔜

## A. `assign` コマンド

* [ ] `--plan <file>` を読み込み、タスク→作業ディレクトリを割当
* [ ] 既存割当：`--map t1=../wt1,t2=../wt2`
* [ ] 自動作成：`--worktree-root ../ --auto-worktree --branch-prefix plan/<id>/`
* [ ] `--codex-home-template "<worktreeDir>/.codex-home-<taskId>"`
* [ ] 出力：`.codex-parallel/assignments-*.json`
* [ ] テスト：map 解析／テンプレ解決／worktree 作成（スタブ）／出力整合

## B. `run` コマンド（並列・依存制御）

* [ ] **Scheduler**：`dependsOn` を解決（DAG）／`--max-parallel` 上限
* [ ] **Runner**：`spawn("codex", …)`（`cwd=worktreeDir`, `env.CODEX_HOME` 設定）
* [ ] **競合ガード**：同一 `CODEX_HOME` の重複利用検知／`--auto-isolate`
* [ ] **停止処理**：Unix=PGIDに `SIGTERM→SIGKILL`、Win=`taskkill /T /F`
* [ ] **Tailer**：

  * [ ] `stdout`/`stderr` を行単位で取得
  * [ ] `$CODEX_HOME/sessions/**/rollout-*.jsonl` を**新規生成にも追従**
  * [ ] すべて `events.ndjson`（`state|stdout|stderr|jsonl`）へ追記（Backpressure安全）
* [ ] **Exit 集約**：失敗時の後続タスクを `blocked/skipped` に
* [ ] テスト：2〜3タスクで直列＋並列が混在する E2E（スタブ Runner で擬似出力）

## C. `tail` コマンド（ミニマム）

* [ ] `events.ndjson` をフォローし、`--run <id|all>`／`--type` でフィルタ表示
* [ ] 色付け（任意）

## D. 受け入れ基準（DoD）検証

* [ ] 「N並列」「依存順序」「CODEX_HOME競合検知/回避」「NDJSON出力」「非0終了」などのE2E

---

# 品質・DX まわり 🧪

* [ ] ユニットテスト追加：`detectCodexFeatures`／`schema` エラー系／`readMaybeFile`／`buildPlannerPrompt`
* [ ] 大量ログ Fixture（10万行相当）で Tailer の耐性を検証
* [ ] カバレッジ閾値設定 & CI バッジ（任意）
* [ ] GitHub Actions：Linux/Windows・Node 18/20/22 マトリクスで `pnpm check`

---

# ドキュメント／配布 📦

* [ ] README（概要・Quickstart・`plan/assign/run` 例・スタブの使い方）
* [ ] ライセンス（例：MIT）
* [ ] 変更履歴（CHANGELOG）と `engines` 指定
* [ ] `example/`（`objective.md`,`plan.json`,`assignments.json`）
* [ ] エラーメッセージ整備（原因と対処のヒント）

---

# Backlog（MVP外・あとで）

* [ ] `history`（軽量メタ or SQLite 索引）
* [ ] `diff`（編集候補ファイルの HEAD 対比）
* [ ] 擬似 `resume`／コスト概算
* [ ] 設定ファイル（`.splitshotrc`）／プロフィール機能

---

## 直近の「次の3手」（迷ったらコレ）

1. **`assign` の最小実装**：`--plan` と `--map` だけで `.codex-parallel/assignments-*.json` を出す
2. **Scheduler**（`dependsOn`＋`--max-parallel`）をテスト先行で作る
3. **Runner+Tailer スタブ**で `events.ndjson` を吐くところまで通す（実 Codex 連携は後で差し替え）

この順で進めれば、MVPのコア（計画→割当→並列実行→ログ）が最短で通ります。必要なら `assign` の雛形コードもここで出します！
