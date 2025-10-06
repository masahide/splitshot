以下は **後方互換なし**で v2 仕様へ移行するための**TDDサイクル（Red → Green → Refactor）付き TODO チェックリスト**です。上から順に進めれば、Step1〜7 の自動化フローが最小迷走で完成します。

---

# 全体ゴール（DoD）

* [ ] `splitshot --help` に新コマンド群（`prompts|step1|step2|step3|worktrees|run|integrate|cleanup|tail`）が並び、説明が最新化されている
* [ ] 新フロー：`prompts up → step1 spec → step2 design → step3 gen-prompts → worktrees up → run → integrate → cleanup` が**E2Eテスト**で緑
* [ ] 旧 `plan` コマンド・旧 `manifest.json`・旧 `plan.stub.json` など v1 系はビルドから除去
* [ ] CI（Vitest）グリーン、最低限の README 更新

---

# 0. E2E 骨格（失敗から始める）

* [ ] **RED**: `tests/e2e/new-flow.e2e.test.ts`

  * 仮のミニリポジトリ fixture を生成し、上記の新フロー一式を CLI で実行 → 期待ファイル群生成を**期待**（まだ実装が無いので失敗）
  * 期待物: `docs/spec.md`, `docs/interface.md`, `docs/todo/agent-*.md`, `.splitshot/plan-*/manifest.v3.json`, `.runs/*/events.ndjson`, PR コマンド（擬似）実行
* [ ] **GREEN**: 各章で作る最小実装がそろった段階でこのテストを徐々に通す
* [ ] **REFACTOR**: フィクスチャ生成共通化、`helpers/e2eRepo.ts` 抽出

---

# 1. 新 Manifest v3（真理テーブル）導入

* [ ] **RED**: `tests/manifest.v3.test.ts`

  * 型 `ManifestV3` & I/O: 読み書き/スキーマ検証/パスの安全性（相対のみ、`..` 禁止）
  * `worktrees`, `docs`, `prompts`, `run` セクションが必須
* [ ] **GREEN**: `src/core/manifest.ts`

  * `readManifestV3(path)`, `writeManifestV3(path, m)`, `validateManifestV3(m)` 実装（Zod使用）
* [ ] **REFACTOR**: 旧 `manifest.json` 読み込みコード削除、`run`/`tail` が v3 を前提に動作

---

# 2. Codex カスタムプロンプト管理

* [ ] **RED**: `tests/prompts.test.ts`

  * `$CODEX_HOME/prompts` への標準セット設置（idempotent）
  * 置換ルール `$1..$9`, `$ARGUMENTS`, `$$` の展開
  * `resolveCodexHome()`（明示オプション＞env＞既定 `~/.codex`）
* [ ] **GREEN**: `src/core/codexPrompts.ts`

  * `installPromptSet(home, presetName='default')`, `renderPrompt(md, argv:string[])`
* [ ] **REFACTOR**: 置換器を純関数化しユニットテスト強化

---

# 3. `splitshot prompts up`

* [ ] **RED**: `tests/cli.prompts.e2e.test.ts`

  * 実行後、`$CODEX_HOME/prompts/{spec,split,agent-ja,if-check}.md` が生成されること
* [ ] **GREEN**: `src/cli/prompts.ts` 実装 & `index.ts` 登録
* [ ] **REFACTOR**: 生成済みとの差分最小化（上書き確認は不要：後方互換なし）

---

# 4. Step1: `splitshot step1 spec`

* [ ] **RED**: `tests/cli.step1.spec.e2e.test.ts`

  * `--objective` を与えると `docs/spec.md` が生成される
  * `docs/docs.index.json` へ登録
  * Codex を呼ばず**モックで代替**（`tests/fixtures/fake-codex.js` が `stdout` に md を出す）
* [ ] **GREEN**: `src/cli/step1.ts`

  * `codex exec` を `execa` 経由で実行（テスト時は `FAKE_CODEX_BIN` で差し替え）
  * `docs/spec.md` 書き出し、`docs.index` 更新
* [ ] **REFACTOR**: 失敗時ログを `plan` の名残りから脱却した文言に統一

---

# 5. Step2: `splitshot step2 design`

* [ ] **RED**: `tests/cli.step2.design.e2e.test.ts`

  * 実行で `docs/todo/agent-a.md` など複数ファイルと `docs/interface.md` を生成
  * `docs.index` 更新
* [ ] **GREEN**: `src/cli/step2.ts` 実装（Step1 と同パターン、プロンプトは `/split`）
* [ ] **REFACTOR**: `writeDocsIndex()` 共通化

---

# 6. Step3: `splitshot step3 gen-prompts`

* [ ] **RED**: `tests/cli.step3.gen-prompts.test.ts`

  * 入力: `docs/todo/*.md` と `docs/interface.md`
  * 出力: `.splitshot/plan-*/checklists/worker-01.md..`（タスク→TDD順/機械検証コマンド末尾固定/編集範囲明記）
  * `manifest.v3.json.docs.todos` と**整合**（個数・対応）
* [ ] **GREEN**: `src/cli/step3.ts` & `src/core/todoParser.ts`

  * TODO Markdown の軽量パーサ、指示テンプレータ
* [ ] **REFACTOR**: 役割ごとにテンプレ分離（レンダラのテスト追加）

---

# 7. Worktrees 管理（up/down）

* [ ] **RED**: `tests/worktrees.test.ts`

  * `up --count 3 --base ../worktrees` で worktree/branch を作成（`execa` をモック）
  * `down` で安全削除。未マージならデフォルト拒否、`--force` で削除
  * `manifest.v3.json.worktrees` を更新
* [ ] **GREEN**: `src/core/worktrees.ts`, `src/cli/worktrees.ts`

  * `git worktree add/remove`, `branch` 操作のラッパー
  * ルート外パスの安全性チェック
* [ ] **REFACTOR**: Git ラッパーとメッセージ共通化

---

# 8. `run` の v2 対応（manifest v3 準拠）

* [ ] **RED**: `tests/run.v2.e2e.test.ts`

  * `manifest.v3.json` を読む
  * `checklists/worker-XX.md` を `codex exec` に渡す
  * `CODEX_HOME` を `.homes/wXX` に分離し、`sessions` JSONL を `events.ndjson` に反映
  * `--max-parallel` 準拠、終了コード集約
* [ ] **GREEN**: `src/cli/run.ts` 改修（読み物を v3 に切り替え）
* [ ] **REFACTOR**: `JsonlFollower` & `eventsWriter` のテスト補強、`run.meta.json` の構造を v3 に合わせて簡素化

---

# 9. `integrate`（コミット/プッシュ/PR）

* [ ] **RED**: `tests/cli.integrate.test.ts`

  * `gh` CLI があれば `gh pr create` を呼ぶ、なければコマンド例を**stdout**に出す
  * コミットメッセージやブランチ名は `manifest.v3.json.worktrees` から
* [ ] **GREEN**: `src/core/git.ts`, `src/core/gh.ts`, `src/cli/integrate.ts`
* [ ] **REFACTOR**: 出力整形、リトライ戦略は最小限（後方互換なしのため割り切り）

---

# 10. `cleanup`

* [ ] **RED**: `tests/cli.cleanup.test.ts`

  * マージ済みブランチのみ削除、未マージはデフォルト拒否
* [ ] **GREEN**: `src/cli/cleanup.ts`（`worktrees.down` を内部利用）
* [ ] **REFACTOR**: エラー文言統一

---

# 11. `tail` の最小改修

* [ ] **RED**: `tests/cli.tail.v2.test.ts`

  * v3 の `.runs/latest.json` と `events.ndjson` を辿れる
  * `--run`, `--type` フィルタ継続
* [ ] **GREEN**: `src/cli/tail.ts`（v3 パス解決へ差し替え）
* [ ] **REFACTOR**: `resolveEventsFile()` の責務を小さく

---

# 12. 旧コードの撤去（互換性破棄）

* [ ] **RED**: `tests/legacy.removed.test.ts`

  * `splitshot plan` 実行で**エラー**または**非存在**（後方互換なし）
* [ ] **GREEN**: `src/cli/plan.ts` と関連参照（`schemas/plan.ts` 等）を削除 or `deprecated/` へ隔離しビルド対象外
* [ ] **REFACTOR**: `package.json` の `bin`/scripts 更新、不要依存の削除

---

# 13. ドキュメント & DX

* [ ] **RED**: `tests/help.output.test.ts`

  * `splitshot --help` と各サブコマンド `--help` の出力が新仕様に整合
* [ ] **GREEN**: コマンド説明・例を更新
* [ ] **REFACTOR**: README を「新フロー」へ全面差し替え

---

# 14. CI とテスト安定化

* [ ] **RED**: `tests/ci.stability.test.ts`

  * 偽 Codex / 偽 gh / 偽 git（execa モック）が**必ず**使われる（本物に依存しない）
* [ ] **GREEN**: `tests/setup.ts` にグローバルモックと一時ディレクトリユーティリティ
* [ ] **REFACTOR**: テスト時間短縮（JSONL フォロー間隔の短縮オプション導入）

---

## 付録：主なファイル追加/変更（案）

* 追加: `src/cli/{prompts,step1,step2,step3,worktrees,integrate,cleanup}.ts`
* 追加: `src/core/{manifest.ts,codexPrompts.ts,todoParser.ts,worktrees.ts,git.ts,gh.ts}`
* 変更: `src/cli/{index.ts,run.ts,tail.ts}`（v3 対応）
* 削除: `src/cli/plan.ts`, `src/schemas/plan.ts`（または `deprecated/` 退避）

---

このチェックリストに沿って **Red → Green → Refactor** を刻めば、最小の迷いで v2 仕様へ移行できます。必要なら最初の 3 章（Manifest v3／Prompts／Step1）だけ先にまとめて通し、そこから Step2/3→run→worktrees→integrate→cleanup の順で拡張してください。
