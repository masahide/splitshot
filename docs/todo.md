いい流れ！**（私見）**
現時点の進捗と残タスクを最新化しました。上から潰せばMVPが閉じます。

---

# 進捗チェックリスト（最新）

## ✅ 完了

* [x] プロジェクト雛形（Node 18+/ESM, pnpm, tsup）
* [x] Lint（ESLint v9 フラット構成）/ Prettier
* [x] Typecheck（`tsconfig.typecheck.json` / `pnpm typecheck`）
* [x] テスト基盤（Vitest、`pretest -> build`）
* [x] Codexスタブ（`tests/fixtures/codex-stub.js`）
* [x] **plan コマンド**

  * [x] `--output-schema`/`--json` 検出（help強化）
  * [x] `--force-schema`
  * [x] Ajv **2020-12** 検証（`ajv/dist/2020.js`）
  * [x] 生成物保存（`.codex-parallel/plan-*.json`, `plan.prompt-*.txt`）
  * [x] テスト：スタブでPlan JSONを取得
* [x] **assign コマンド（最小）**

  * [x] `--plan` 読み込み、`--map` で worktree に割当
  * [x] `--codex-home-template` 展開
  * [x] 出力：`.codex-parallel/assignments-*.json`
  * [x] テスト：割当/保存を検証
* [x] **scheduler（buildBatches）**

  * [x] 依存DAG→並列バッチ化
  * [x] 循環検出
  * [x] テスト：トポロジー/循環

---

## 🔜 残タスク（MVP必須）

### A. `run` コマンド（コア）

* [ ] `--assign <file>` 読み込み
* [ ] **スケジューリング**：`buildBatches` を使って層ごと実行
* [ ] **max並列**：`--max-parallel` セマフォ制御
* [ ] **プロセス起動**：`spawn("codex", …)`（`cwd=worktreeDir`, `env.CODEX_HOME`）
* [ ] `--codex-args "<…>"` 透過
* [ ] **CODEX_HOME競合検知**：同一パスの同時起動禁止／`--auto-isolate` でサフィックス付与
* [ ] **ログ収集**：

  * [ ] `stdout`/`stderr` を行単位で `events.ndjson` に書く
  * [ ] `$CODEX_HOME/sessions/**/rollout-*.jsonl` を**後出しにも追従**して取り込み
  * [ ] バックプレッシャ対応（バッファ/flush）
* [ ] **状態管理**：`start/exit` イベント、exit code 記録
* [ ] **失敗伝播**：失敗したタスクの子は `blocked/skipped`
* [ ] **終了コード**：いずれか失敗で非0

**テスト（TDD）**

* [ ] ランナースタブで擬似 `stdout/stderr/jsonl` を吐き、`events.ndjson` を検証
* [ ] `--max-parallel` 制約の順序性
* [ ] 失敗→依存タスク `blocked` になること
* [ ] `--auto-isolate` の動作
* [ ] 大量ログ（擬似10万行）で欠落なし

### B. `tail` コマンド（ミニマム）

* [ ] `events.ndjson` のフォロー（`--run <id|all>` / `--type` フィルタ）
* [ ] 色付け（任意）
* [ ] テスト：フィルタと追尾が効く

### C. `assign` の拡張（仕様にあった分）

* [ ] **自動 worktree 作成**：`--worktree-root` / `--auto-worktree` / `--branch-prefix`
* [ ] `git` 呼び出しヘルパ（`git.ts`）＋スタブテスト

---

## 🧪 品質/DX（MVP同梱したい）

* [ ] `detectCodexFeatures` の単体テスト（help出力スタブ）
* [ ] `schema.ts` エラー系テスト（必須項目欠落）
* [ ] `planner`/`readMaybeFile` の単体テスト
* [ ] `pnpm check` をCI（GitHub Actions）に導入：Linux/Windows × Node 18/20/22
* [ ] README：Quickstart（スタブ/実機Codexの両方）、コマンド例
* [ ] ライセンス、`engines`、`example/`（`objective.md` など）

---

## 🎯 直近の“次の3手”

1. **`run` のRED**：最小E2E（2層＋max-parallel=1）で`events.ndjson`生成を期待 → 失敗させる
2. **Runner/TailerのスタブGREEN**：外部`codex`をまだ呼ばず、擬似プロセスで`events.ndjson`を書かせる
3. **実プロセス差し替え**：`spawn`＋CODEX_HOME設定→`rollout-*.jsonl`取り込み→失敗伝播

---

何か順序を微調整したければ言って。`run` の RED 用テスト雛形もすぐ出せます（私見）。
