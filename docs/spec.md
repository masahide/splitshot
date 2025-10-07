# SplitShot v2 仕様（Codex 並列実行オーケストレータ）


## ゴール

* Codex の**カスタムプロンプト**を前提に、Step1（仕様書 `docs/spec.md`）と Step2（タスク分割 `docs/todo/*.md` と `docs/interface.md`）を半自動化。
* Step3（各エージェントへの**具体プロンプト**）を**機械的**に生成。
* Step4/5（**git worktree** 作成と並列実行）を**ワンコマンド**で実行。
* Step6（統合〜PR）と Step7（クリーンアップ）を**支援コマンド**で実施。
* 既存の `.splitshot/plan-*/` 構造・イベントログ（`events.ndjson`）を**活かしつつ**拡張。

## 非ゴール

* Codex UI の slash メニュー操作そのものの自動化（*代替としてプロンプト Markdown を配置/展開して `codex exec` で投げます*）。
* GitHub API のネイティブ実装（**既定は `gh` CLI** にオフロード。未インストール時は手順提示）。

---

## 参照ステップ（ドキュメント対応）

* **Step1**: 仕様合意→`docs/spec.md` 作成。
* **Step2**: タスク分割 & **厳密な I/F** → `docs/todo/agent-*.md`, `docs/interface.md`。
* **Step3**: 各 AI 実装用の**指示書（プロンプト）**を生成。
* **Step4/5**: **git worktree** 整備 → 各エージェント同時起動。
* **Step6**: 仕上げ統合 & PR。
* **Step7**: 片付け（worktree/branch 削除）。

---

## 全体フロー（v2）

```
splitshot prompts up
 └─ CODEX_HOME/prompts に標準プロンプト一式を設置

splitshot step1 spec --objective docs/spec.objective.md
 └─ /spec プロンプトを展開して codex exec → docs/spec.md

splitshot step2 design
 └─ /split プロンプトを展開して codex exec → docs/todo/*.md, docs/interface.md

splitshot step3 gen-prompts
 └─ docs/todo/*.md + docs/interface.md を機械解釈 → .splitshot/plan-*/checklists/wNN.md

splitshot worktrees up --count 3
 └─ ../worktrees/agent-01..03 を作成（外部ディレクトリ推奨）

splitshot run --plan-dir <latest> --max-parallel 3
 └─ 各 wNN を並列に codex exec（CODEX_HOME 分離、events.ndjson 追跡）

splitshot integrate
 └─ コミット/プッシュ/PR（gh CLI があれば自動、なければコマンド例提示）

splitshot cleanup
 └─ worktree/branch を安全に削除
```

---

## ディレクトリ & 成果物

```
repo/
 ├─ docs/
 │   ├─ spec.md                        # Step1 生成
 │   ├─ interface.md                   # Step2 生成
 │   └─ todo/
 │       ├─ agent-a.md                 # Step2 生成（以降ツールが読む）
 │       ├─ agent-b.md
 │       └─ agent-c.md
 ├─ .splitshot/
 │   ├─ plan-1730.../
 │   │   ├─ manifest.v3.json           # ★ステップ横断メタ
 │   │   ├─ checklists/
 │   │   │   ├─ worker-01.md           # Step3 生成（エージェント指示）
 │   │   │   └─ worker-02.md ...
 │   │   ├─ .homes/w01, .homes/w02...  # CODEX_HOME 分離ディレクトリ
 │   │   ├─ .runs/<ts>/events.ndjson   # 実行ログ
 │   │   └─ docs/docs.index.json       # 生成物インデックス
 │   └─ _schemas/..., _tmp/...
 └─ ...
```

---

## カスタムプロンプト（Codex用）設置

**コマンド:** `splitshot prompts up [--home <dir>]`
**やること:**

* `$CODEX_HOME/prompts/`（既定 `~/.codex/prompts/`）に下記を生成/更新。
* 生成ファイル例（*.md）：

  * `spec.md`（slash: `/spec`）

    * 入力: 目的/背景、対象範囲、非ゴール、成功条件、I/O、テスト戦略
    * **Deliverables**: `docs/spec.md` に Markdown で保存すること
  * `split.md`（slash: `/split`）

    * 入力: `docs/spec.md`
    * 出力: `docs/todo/agent-*.md`（TDDチェックリスト、機械検証項目含む）、`docs/interface.md`（厳密I/F）
  * `if-check.md`（slash: `/if-check`）

    * 入力: TODO 群と I/F
    * 出力: 整合性レポート（任意）
  * `agent-ja.md`（slash: `/agent-ja`）

    * TODO/IF の**日本語化**支援（必要に応じ使用）

> **備考**: slash 実行は**手動**でも、ツールは**同等内容**を読み込み、**$1..$9** 等の引数展開も**自前実装**で代替します（`codex exec -- "<展開済み本文>"` を実行）。

---

## CLI 詳細（新設/改修）

### 1) `splitshot step1 spec`

* **目的**: `/spec` プロンプトを展開→Codex 非対話実行で `docs/spec.md` を生成。
* **主な引数**

  * `--objective <file>`: 仕様のタネ（箇条書き/要件ラフ等）
  * `--codex-home <dir>`: CODEX_HOME 指定（既定: 環境変数 `CODEX_HOME` → `~/.codex`）
  * `--codex-bin <path>`: Codex 実行バイナリ（既定 `codex`。テスト時はスタブで差し替え）
* **処理**

  1. `prompts/spec.md` を読み、**引数展開**（$1..$9 / $ARGUMENTS 相当）。
  2. `codex exec --color never -- "<展開本文>"` を**repo ルート**で実行。
  3. `docs/spec.md` の存在を検査（`docs/docs.index.json` へ登録）。

### 2) `splitshot step2 design`

* **目的**: `/split` を展開→`docs/todo/*.md` と `docs/interface.md` を生成。
* **処理**: step1 と同様。完了後、**docs.index** を更新。

### 3) `splitshot step3 gen-prompts`

* **目的**: Step2 生成物から**各エージェント用の指示書**を**機械生成**。
* **入力**: `docs/todo/*.md`, `docs/interface.md`
* **出力**: `.splitshot/plan-*/checklists/worker-XX.md`
* **生成ポリシー**

  * **TDD型**（「テスト → 実装 → リファクタ」）で並べ替え。
  * **編集範囲の制限**（例: `src/api/** のみ`）を明記。
  * **機械検証項目**（TODO 側で指定されたものをそのまま掲載。指定が無い場合はフォールバックで `pnpm test` を追加）。
  * **完了時の TODO チェック反映**（`- [ ] → - [x]`）の指示を含む。

### 4) `splitshot worktrees up` / `splitshot worktrees down`

* **up の役割**

  * `../worktrees/agent-01..NN`（repo 外）を作成し、`feature/agent-01..NN` を付与。
  * `.splitshot/plan-*/manifest.v3.json` に**worktree マップ**を保存。
* **down の役割**

  * 使い終わった worktree の**安全削除** & ブランチ削除（未マージは警告）。

### 5) `splitshot run`（改修）

* **新要素**

  * `--create-worktrees`（省略時は既存流用）
  * `--worktree-base ../worktrees` / `--branch-prefix feature/agent-`
  * `--jsonl-interval <ms>`（既定 200ms）
* **挙動**

  * 既存の**並列実行**を踏襲（`events.ndjson` 追跡、`CODEX_HOME` 分離、権限ファイル継承）。
  * **prompt は Step3 生成の `checklists/worker-XX.md`** をそのまま `codex exec` の本文として投げる。

### 6) `splitshot integrate`

* **目的**: 仕上げのコミット、プッシュ、PR を**半自動**化。
* **優先**: `gh` CLI があれば `gh pr create` を使用。なければ**実行例**を提示。
* **オプション**

  * `--base main` / `--title-prefix "[AI]"` / `--draft`
  * `--no-open`（PR URL を表示のみ）

### 7) `splitshot cleanup`

* **目的**: マージ済みブランチの**worktree/branch 削除**。
* **安全策**: 未マージ検出時はデフォルト拒否（`--force` で上書き）。

---

## Manifest / Schema（新）

### `manifest.v3.json`（新規・横断管理）

```json
{
  "version": 3,
  "createdAt": "2025-10-06T12:34:56.000Z",
  "docs": {
    "spec": "docs/spec.md",
    "interface": "docs/interface.md",
    "todos": ["docs/todo/agent-a.md", "docs/todo/agent-b.md", "docs/todo/agent-c.md"]
  },
  "worktrees": {
    "base": ".splitshot/worktrees",
    "branches": []
  },
  "prompts": {
    "sourceHome": ".codex/prompts",
    "used": ["spec.md", "split.md"]
  },
  "run": {
    "maxParallel": 3,
    "codexHomes": { "w01": ".homes/w01", "w02": ".homes/w02", "w03": ".homes/w03" },
    "events": ".runs/bootstrap/events.ndjson"
  }
}
```

> v1 の `plan.json` / `PlanSchema` は廃止済み。`manifest.v3.json` が**単一の真理テーブル**として run / tail / worktrees / cleanup から参照されます。

---

## テンプレ：プロンプト抜粋（生成内容イメージ）

### `prompts/spec.md`（/spec）

* **指示**: 与えられた目的を整理し、`docs/spec.md` を**新規作成・上書き**。章立て例：目的／非ゴール／成功基準／I/O／テスト戦略／リスク／段階的リリース。
* **注意**: ファイルパスは**相対**、サイズ目安 50KB、**日本語**で。
* **Deliverables**: `docs/spec.md`（Markdown）

### `prompts/split.md`（/split）

* **入力**: `docs/spec.md`
* **生成**:

  * `docs/todo/agent-*.md`：**TDD チェックリスト**、**機械検証**（例: `pnpm test` や `pnpm typecheck`）を末尾に固定。
  * `docs/interface.md`：**厳密 I/F**（責務境界、I/O 型、契約、例外、CLI/HTTP/イベント仕様）。
* **整合性**: TODO ⇄ I/F のズレがないか最後に**自己チェック**。

---

## 実装計画（差分）

* `src/cli/index.ts`

  * 新コマンド登録：`prompts`, `step1`, `step2`, `step3`, `worktrees`, `integrate`, `cleanup`
* 追加モジュール

  * `src/core/codexPrompts.ts`：プロンプト設置/読込、$1.. 展開
  * `src/core/codexFiles.ts`：Codex 実行結果のファイル書き出し安全化
  * `src/core/docsIndex.ts`：生成ドキュメントのインデックス管理
  * `src/core/todoParser.ts`：TODO Markdown の軽量パーサ
  * `src/core/manifest.ts`：`manifest.v3.json` の I/O
  * `src/core/worktrees.ts`：worktree add/remove ラッパ
  * `src/core/git.ts`：commit/push のラッパ（`execa`）
  * `src/core/gh.ts`：`gh` CLI 検出と PR 作成（オプショナル）
* 既存改修

  * `src/cli/index.ts`：新コマンド群を登録
  * `src/cli/run.ts`：`manifest.v3.json` ベースの並列実行へ刷新
  * `src/cli/tail.ts`：v3 フォーマットの runs データを参照
  * `src/cli/worktrees.ts` / `src/cli/cleanup.ts` / `src/cli/integrate.ts`：manifest v3 を前提に動作
  * `src/core/paths.ts`：plan ディレクトリ検出・安全性チェックを提供

---

## エラーハンドリング & ユーザ体験

* **必須ファイル欠如**時：不足項目を列挙し、**最短コマンド**例を併記。
* **Codex 401**：`inheritCodexAuthFiles` の注意喚起文を表示。
* **gh CLI 不在**：`git push` と `gh pr create` の**代替コマンド例**をその場に出力。
* **未マージ cleanup**：PR URL を提示し、`--force` 無しでは削除しない。

---

## テスト戦略（TDD）

* **ユニット**：$1.. 展開、path 安全性、worktree add/remove、events 追跡。
* **E2E**：テンポラリ repo で Step1→Step3→run→integrate→cleanup の**通し**（`gh` はモック）。
* **回帰**：既存 `buildBatches` や `events` 系は**互換**テスト維持。

---

## 使い方クイックスタート

```bash
# 0) プロンプト設置
splitshot prompts up

# 1) 仕様作成（Step1）
splitshot step1 spec --objective docs/spec.objective.md

# 2) タスク分割 + I/F（Step2）
splitshot step2 design

# 3) 各エージェント指示書生成（Step3）
splitshot step3 gen-prompts

# 4) worktree 準備（Step4）
splitshot worktrees up --count 3

# 5) 並列実行（Step5）
splitshot run --max-parallel 3

# 6) 統合・PR（Step6）
splitshot integrate --base main --draft

# 7) 片付け（Step7）
splitshot cleanup
```

---

## メモ

* Step4 では **リポジトリ外**に worktree を作るのが安全（CI/ツールの誤検知回避）。
* TODO には**機械検証**と**チェック更新**（`- [ ] → - [x]`）の指示を**必ず含める**。
