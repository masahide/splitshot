# SplitShot Web UI — フェーズ2 **MVP 仕様書**

> 最終更新: 2025-09-27
> 対象: 既存 **2モードCLI（plan / run）** に最小の Web UI を追加し、**プラン作成 → 実行 → 可視化** を一気通貫で行えるようにする

---

## 1. 概要

**SplitShot Web UI（MVP）** はローカル環境で動かす小さな Web アプリです。
画面上の 3 ステップだけで完結します。

1. **プラン作成（Plan）**
   目的文と並列数を入れて「作成」。CLI の `splitshot plan` を裏で呼び、
   `plan-dir`（`plan.json / manifest.json / checklists/**`）を生成します。

2. **並列実行（Run）**
   作成したプランを選んで「実行」。CLI の `splitshot run` を呼び、
   `.runs/<ts>/events.ndjson` を生成します。

3. **ライブ可視化（Tail）**
   `events.ndjson` をブラウザで追尾（SSE）し、`state/stdout/stderr/jsonl` をリアルタイム表示。
   完了後は `run.meta.json / events.ndjson` をダウンロードできます。

> **非ゴール（MVP）**: 多ユーザー／認証、DAG編集、キャンセル/リトライ、Web からのチェックリスト編集。

---

## 2. 画面仕様

### 2.1 ダッシュボード（Plan 一覧）

* 目的: 既存 `./.splitshot/plan-*` を一覧表示し、最新 Run 状態も把握。
* 要素:

  * **［新規プラン作成］** ボタン
  * **Plan List**（`plan-<ts>` / 作成日時 / workers 数 / 最新 run の status）
  * 行末アクション: **詳細** / **実行**

### 2.2 新規プラン作成

* 目的: `splitshot plan` を GUI で実行。
* 入力項目（MVP）:

  * **Objective**: テキスト（複数行） or ファイルアップロード（どちらか必須）
  * **Workers**: 数値（既定 2〜3）
  * **Codex Bin**: 既定 `codex`（`.js` も可）
  * **Planner Home**: 既定 `./.codex-home-planner`
  * **Force Schema**: ON の場合、機能検出をスキップして `--output-schema` を強制
  * **Timeout (ms)**: 既定 120000
* 出力:

  * 成功: **作成された plan-dir へのリンク**（Plan 詳細へ遷移）
  * 失敗: 簡潔なエラー（原因＋対処ヒント）

> 備考: Zod 定義（`src/templates/plan.zod.ts`）から **JSON Schema（2020-12）** をサーバで生成し、`--output-schema` で CLI に渡します（既存 CLI 仕様に準拠）。

### 2.3 Plan 詳細

* 表示:

  * **manifest.json** の概要（objective / createdAt / workers）
  * **チェックリスト一覧**（先頭をプレビュー）
  * `plan.json` / `plan.prompt.txt` へのリンク
* 実行フォーム:

  * **Codex Bin**（既定: `codex`）
  * **Max Parallel**（既定: `workers.length`）
  * **CODEX_HOME テンプレ**（既定: `<planDir>/.homes/<workerId>`）
  * **［このプランで実行］**

### 2.4 Run 詳細（ライブ）

* 表示:

  * **Run 概要**: runId（`.runs/<ts>`）/ `maxParallel` / `codexHomes`（`run.meta.json`）
  * **ワーカー状態**: `start / exit(code) / blocked` を色バッジで可視化
  * **イベントビュー（SSE）**: タブ（All / stdout / stderr / jsonl / state）、
    フィルタ（worker, type, テキスト検索）、ライブ追尾 ON/OFF
  * **ダウンロード**: `events.ndjson` / `run.meta.json`

---

## 3. バックエンド API（MVP）

### 3.1 Plans

* `GET /api/plans`
  `.splitshot/plan-*` を列挙しメタを返す。
* `GET /api/plans/:planId`
  `manifest.json` と主要ファイルパス（`plan.json` / `plan.prompt.txt` / `checklists/**`）。
* `GET /api/files?path=<safe>`
  テキストファイル中身（UTF-8）を返す（ベース外は拒否）。

### 3.2 Plan 作成（新規追加）

* `POST /api/plans`

  * **body（JSON or multipart）**:

    ```json
    {
      "objectiveText": "...",      // または objectiveFile（multipart）
      "workers": 2,
      "codexBin": "codex",
      "plannerHome": ".codex-home-planner",
      "forceSchema": false,
      "timeoutMs": 120000
    }
    ```
  * **処理**:

    1. サーバが Zod → JSON Schema を一時生成（`writePlanJsonSchemaFile` 相当）。
    2. `splitshot plan` を `--output-schema` つきで spawn（`--objective` はテキスト or 一時ファイル）。
    3. `stdout` から `{ planDir }` を取得。
  * **201**:

    ```json
    { "planId": "plan-1738030000000", "planDir": "/abs/.../plan-1738030000000" }
    ```
  * **エラー**: 400/500（原因＋対処ヒントを付与）

* **オプション（任意 API）**:

  * `GET /api/schema/plan` — 現行 Zod から生成した JSON Schema を返す（UI で “出力形の確認” に利用可）。

### 3.3 Runs

* `POST /api/runs`

  ```json
  {
    "planDir": "/abs/.../plan-1738030000000",
    "codexBin": "codex",
    "maxParallel": 2,
    "codexHomeTemplate": "<planDir>/.homes/<workerId>"
  }
  ```

  * **201**: `{ "runId": "1738031111111", "runDir": "/abs/.../.runs/1738031111111" }`
* `GET /api/runs/:runId/meta` — `run.meta.json`
* `GET /api/runs/:runId/events/stream` — **SSE**（`events.ndjson` を 200ms 間隔で tail）

> セキュアパス: **ベースディレクトリ固定**＋正規化で外部参照禁止。

---

## 4. 内部フロー（要点）

### 4.1 Plan 作成フロー

```
UI → POST /api/plans
    → Server:
       1) Zod→JSON Schema 生成（tmp）
       2) spawn: splitshot plan --objective <text|tmpfile> --workers N
                 --codex-bin <...> --planner-home <...> [--force-schema]
       3) stdout の {planDir} を parse
       4) 201 で planDir を返す
UI ← planDir を受け取り Plan 詳細へ遷移
```

### 4.2 Run 可視化フロー

```
UI → POST /api/runs → runId
UI → SSE /api/runs/:runId/events/stream
Server: events.ndjson を tail し行単位で push（data:<json>\n\n）
```

---

## 5. 設定・前提

```yaml
# server.config.(yaml|json)
splitshotBaseDir: "./.splitshot"
pollingIntervalMs: 200          # SSE tail 間隔
defaultCodexBin: "codex"
defaultPlannerHome: ".codex-home-planner"
port: 5174
```

* CLI `dist/cli/index.js` が実行可能であること（PATH or 絶対パス設定）。
* **ローカル前提**。外部公開時は **認証/CORS/CSRF** を追加。

---

## 6. エラーハンドリング指針

* **Plan 作成失敗**:

  * 例: codex 未検出 →
    `codex not found. Hint: Install Codex or set "Codex Bin" to a JS runner stub`
  * 例: objective 未入力 →
    `objective is required (text or file)`
* **Run 失敗**:

  * CODEX_HOME 競合（auto-isolate OFF）→
    `Duplicate CODEX_HOME detected ... Hint: Enable auto-isolation or change template`
* UI はエラーをトースト＋詳細モーダルで提示し、**再入力**を促す。

---

## 7. 実装スケルトン

```
apps/
  server/
    src/index.ts           # Express 起動/ルーティング
    src/plan.ts            # POST /api/plans, GET /api/plans*
    src/run.ts             # POST /api/runs, SSE
    src/fsutil.ts          # パス安全化・ベース固定・テキスト読み
    src/schema.ts          # Zod→JSON Schema 生成
    src/sseTail.ts         # events.ndjson tailer
  web/
    src/pages/Dashboard.tsx
    src/pages/PlanCreate.tsx
    src/pages/PlanDetail.tsx
    src/pages/RunDetail.tsx
    src/components/{EventStream,WorkerGrid,FilePreview}.tsx
```

---

## 8. テスト（MVP）

* **サーバ単体**:

  * `POST /api/plans`：fixtures の `codex-stub.js` で `{planDir}` が返る
  * `POST /api/runs`：`codex-runner-stub.js` で `.runs/<ts>` 作成
  * `GET /events/stream`：追記で SSE が流れる
* **UI E2E（最小）**:

  * PlanCreate → PlanDetail → RunDetail（フィルタ操作）
* **大量ログ**:

  * 10万行の追尾で UI が固まらない（表示上限＋ローテーション）

---

## 9. 既知の制約 / 次段ロードマップ

* **制約**:

  * プラン作成は **単一フォームから1回**（ドラフト保存なし）
  * チェックリストの Web 編集は非対応
* **次段**:

  * Web からの **plan 再生成**（過去 objective の再利用）
  * **DAG 可視化**（`buildBatches` レイヤ表示）
  * **キャンセル/再実行**、通知（Desktop/Slack）
  * 仮想リスト＋サーバサイド検索（長大ログ最適化）