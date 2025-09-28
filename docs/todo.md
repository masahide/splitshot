# SplitShot「Codexがファイルを書き、CLIは“作成されたパスだけ”を受け取る」移行計画（**後方互換なし** / TDD TODO）

> 目的：**plan フェーズ**で Codex に **docs/** 配下の成果物ファイル（ワーカーTODOと結合I/F仕様）を**実際に書かせ**、SplitShot は **JSON（`generatedFiles[]`）で “作成されたファイルパスの目録だけ” を受け取り**検証・索引化する。
> 既存の `documents[]`（本文を返す方式）は **廃止**します（後方互換なし）。

---

## 全体方針（設計ゴール）

* **出力責務の移譲**：コンテンツ生成は Codex（モデル）側。SplitShot は **パス検証・索引化**に専念。
* **安全性**：Codex の作業ルートを **plan-dir** に固定し、`--sandbox workspace-write` で **docs/** 配下への書き込みのみを促す。相対パスのみ許可し **パストラバーサル排除**。
* **可観測性**：作成されたファイルは **`plan-dir/docs/docs.index.json`** に **存在/サイズ/sha256** をまとめる。
* **運用性**：ワーカー数 `N` に応じて **必ず**

  * `docs/worker-task/XX/todo.md`（`XX = 01..N`）
  * `docs/interface.md`（結合I/F仕様）
    を **Codex が作成** → `generatedFiles[]` に列挙。

---

## 変更点サマリ（破壊的）

* **Plan スキーマ**：`documents[]` を削除し、**`generatedFiles[]`（必須）** を新設。
* **Planner プロンプト**：

  * 「docs/** に実ファイルを書け」
  * 「書いたファイルの相対パス一覧を `generatedFiles[]` に返せ」
    を明示（日本語本文、Markdown、2桁ワーカー番号、`..` 禁止など）。
* **Codex 実行**：`planDir` を **先に作成**して `codex exec --cd <planDir> --sandbox workspace-write --skip-git-repo-check` で実行。
  `--output-last-message` が使える場合は最終 JSON をファイル経由で取得。
* **検証/索引**：`generatedFiles[]` を **安全確認 → 存在・サイズ・sha256 を計測**し、`docs/docs.index.json` を生成。
* **テスト/フィクスチャ**：plan 用 Codex スタブを **「ファイルを書いてから JSON を返す」** 仕様へ差し替え。

---

# TDD TODO チェックリスト（RED → GREEN → REFACTOR）

## 0) 下準備

* [ ] **RED**: 新フィクスチャ `tests/fixtures/codex-plan-writes-files-stub.js` のテストを追加
  **期待**：このスタブを `codex exec` として呼ぶと

  1. `--cd <dir>` を検出して `<dir>/docs/worker-task/01/todo.md` 等を作成
  2. `stdout`（または `--output-last-message` 指定時はファイル）で **新スキーマ**に合致する JSON（`generatedFiles[]` 含む）を返す
* [ ] **GREEN**: フィクスチャ実装（Node ESM / shebang / 書き込み & JSON 出力）
* [ ] **REFACTOR**: 既存の plan 系テストが使う Codex スタブを **本フィクスチャに統一**

---

## 1) スキーマ更新（`generatedFiles[]` の導入）

* [ ] **RED**: `tests/schemas.plan.generated-files.test.ts` 新規
  **期待**：`parsePlanFromText` が

  * `generatedFiles` **必須（min 1）**
  * 各要素 `{ path: string, description?: string, role?: "worker-todo"|"interface"|"other", workerId?: "w01"|"w02"|... }`
  * 余計なキーは **拒否**
    を満たさない JSON を **エラー**にする
* [ ] **GREEN**: `src/schemas/plan.ts`

  * `documents` **削除**
  * `generatedFiles` を **必須** で追加（`min(1)`、`strict()`、`z.enum` ロール、`workerId` は `"w" + 2桁` パターンなら `refine` で厳密化しても可）
  * `writePlanJsonSchemaFile` はそのまま（Zod→JSON Schema）
* [ ] **REFACTOR**: `src/templates/plan.zod.ts` も **同定義**へ更新（利用箇所のコメントも同期）

---

## 2) Planner プロンプト（出力責務の移譲）

* [ ] **RED**: `tests/planner.prompt.contains-generated-files.test.ts` 新規
  **期待**：`buildPlannerPrompt({ objective, workers: 3 })` に

  * 「**docs/** に実ファイルを書け」
  * 「**generatedFiles[]** を返せ」
  * 「`docs/worker-task/XX/todo.md` と `docs/interface.md` を必ず作れ」
  * 「相対パス（`..` 禁止）、日本語、Markdown、ファイルは50KB程度まで」
    が**含まれる**
* [ ] **GREEN**: `src/core/planner.ts` に該当文言を追記
* [ ] **REFACTOR**: 文面を定数化（`PLANNER_DELIVERABLES_HINT` など）してテストの変更耐性を上げる

---

## 3) Codex 実行（planDir を CD に / 書き込み許可）

* [ ] **RED**: `tests/plan.generated-files.e2e.test.ts` 新規
  **流れ**：

  1. `splitshot plan --objective "..." --workers 2 --codex-bin tests/fixtures/codex-plan-writes-files-stub.js`
  2. `planDir` が返る
  3. `planDir/docs/worker-task/01/todo.md` と `docs/interface.md` が**存在**
  4. `plan.json` の `generatedFiles[]` にそれらの **相対パス**が含まれ、**`docs/docs.index.json`** が生成されていて、各ファイルの `{ exists:true, bytes>0, sha256:40hex }` を持つ
* [ ] **GREEN**: `src/cli/plan.ts`

  * `planDir` を **先に作成**
  * `execCodexWithSchema` に `extraArgs: ["--cd", planDir, "--sandbox", "workspace-write", "--skip-git-repo-check"]` を渡す
  * `--output-last-message` 検出時はファイル経由で JSON 取得（既存の検出関数を利用）
  * `generatedFiles[]` を **安全検証**して `docs/docs.index.json` を作成（存在・サイズ・sha256）
* [ ] **REFACTOR**: パス検証ロジックを `src/core/paths.ts` にユーティリティ化（`isSafeRelativeUnder(base, rel)`）

---

## 4) セキュリティ（パストラバーサル/外部書き込み防止）

* [ ] **RED**: `tests/plan.generated-files.safety.test.ts` 新規
  **期待**：Codex が（テスト用スタブで）`generatedFiles` に `../evil.md` を混ぜてきても

  * `docs.index.json` では **`exists:false`** かつ **無視**される（`base` 外のパスは採用しない）
  * もちろんリポジトリ外に**ファイルは作られない**（スタブ自体は書かない）
* [ ] **GREEN**: `src/cli/plan.ts` の検証で `path.resolve(planDir, rel).startsWith(planDir + path.sep)` を満たさないものは **除外**
* [ ] **REFACTOR**: 除外理由を `docs.index.json` の各要素に `validPath: boolean` として格納しても良い（診断容易化）

---

## 5) 既存テストのアップデート（後方互換廃止の追従）

* [ ] **RED**: 既存の plan 系 E2E（`tests/plan*.test.ts` など）の Codex スタブを **新フィクスチャ**に置換
  **期待**：`plan.json` のスキーマが新仕様（`generatedFiles[]` 必須）で検証される
* [ ] **GREEN**: テスト修正（`withTmp` での `cwd` 隔離は現状のまま）
* [ ] **REFACTOR**: 古い `documents[]` に関するテストやコードを**削除**

---

## 6) マニフェスト/メタ（任意の強化）

* [ ] **RED**: `tests/manifest.includes.docsIndex.test.ts`（任意）
  **期待**：`manifest.json` に `docsIndex: "docs/docs.index.json"` を追加し、存在する
* [ ] **GREEN**: `src/cli/plan.ts` で `manifest` に `docsIndex` を追加
* [ ] **REFACTOR**: WebUI が辿りやすいよう `manifest` に `workers[i].todo`（例：`docs/worker-task/01/todo.md`）を入れてもよい

---

## 7) エラーメッセージ整備

* [ ] **RED**: `tests/errors.generated-files.messages.test.ts` 新規
  **期待**：

  * Codex 実行成功だが `generatedFiles[]` が **空/欠落** → `splitshot plan` が **明確なエラー**（「Codex が成果物を書いていません」＋ヒント）
  * `docs/index` 書き出し失敗 → **対処ヒント**付きメッセージ
* [ ] **GREEN**: `src/core/errors.ts` の `formatCliError` を使用して `cmdPlan` にハンドリング追加
* [ ] **REFACTOR**: メッセージ定数化・日本語/英語の簡易切替（必要なら）

---

## 8) ドキュメント更新

* [ ] **RED**: `tests/readme.snippets.test.ts`（任意）
  **期待**：README の最短手順（plan→run）が新仕様で動く簡易スモーク
* [ ] **GREEN**: `README.md` / `docs/spec.md` を更新

  * 新しい Plan スキーマ（`generatedFiles[]`）
  * Codex に書かせるファイル（`docs/worker-task/XX/todo.md`, `docs/interface.md`）
  * `docs/docs.index.json` の構造サンプル
* [ ] **REFACTOR**: 古い仕様の記述削除

---

# 実装メモ（抜粋コード方針）

* **Zod（Plan）**：

  ```ts
  const GeneratedFileZ = z.object({
    path: z.string(),
    description: z.string().optional(),
    role: z.enum(["worker-todo","interface","other"]).optional(),
    workerId: z.string().regex(/^w\d{2}$/).optional(),
  }).strict();

  export const PlanSchema = z.object({
    meta: z.object({ objective: z.string().optional(), workers: z.number().int().min(1).optional() }).optional(),
    tasks: z.array(TaskSpecSchema).min(1),
    generatedFiles: z.array(GeneratedFileZ).min(1), // ← 必須
  }).strict();
  ```

* **安全なパス確認**：

  ```ts
  function safeAbs(planDir: string, rel: string): string | null {
    const abs = path.resolve(planDir, rel);
    return abs.startsWith(planDir + path.sep) ? abs : null;
  }
  ```

* **docs.index.json**（例）：

  ```json
  {
    "files": [
      { "path": "docs/worker-task/01/todo.md", "role": "worker-todo", "workerId": "w01",
        "exists": true, "bytes": 1234, "sha256": "ab12..."},
      { "path": "docs/interface.md", "role": "interface",
        "exists": true, "bytes": 4567, "sha256": "cd34..."}
    ]
  }
  ```

* **Codex 実行**：
  `extraArgs: ["--cd", planDir, "--sandbox", "workspace-write", "--skip-git-repo-check"]` を常時付与。
  `--output-last-message` 検出時はファイル優先（標準出力は汚染され得るため）。

---

## 完了の定義（Definition of Done）

* `pnpm test` が **すべて GREEN**（新規 RED テスト含む）。
* `splitshot plan ...` で

  * `plan.json` が新スキーマ（`generatedFiles[]`）で保存
  * `docs/worker-task/XX/todo.md` と `docs/interface.md` が実在
  * `docs/docs.index.json` に正しいメタ（exists/bytes/sha256）が入る
* 既存 `run/tail` の E2E は影響なく **GREEN**。
