# SplitShot — CLI MVP 仕様書（フェーズ1・更新版）

## プロジェクト概要

**SplitShot** は、Codex を**並列実行**するための CLI です。
特徴は以下（MVP時点）：

* **Plan Assist**：Codex の **`--output-schema` 構造化出力**で “並列タスク計画” を生成
* **安全な並列起動**：タスクごとに `CODEX_HOME` を **worktree 単位で自動分離**（競合ガード）
* **再現性**：Plan JSON/プロンプト、各 Run のイベントを **機械可読（JSON/NDJSON）** で保存
* **将来拡張**：フェーズ2で **SSE WebUI** を載せても、そのまま使えるデータ形（NDJSON）

> ねらい：**「計画 → 並列実行 → ログ」** の最小ループを CLI 1本で回し、後から UI を被せても非互換が出ない土台を作る（私見）。

---

## スコープ（MVPでやる/やらない）

**やる**

* `plan`：構造化出力で **並列タスク計画**を生成（Schema 検証つき）
* `assign`：タスク→worktree/CODEX_HOME の割当（自動 worktree 作成は任意）
* `run`：割当にもとづく **並列実行**（依存関係/同時上限/競合ガード）
* `tail`（任意）：コンソールでログ追尾
* 出力の永続化：`.codex-parallel/` に JSON/NDJSON を保存

**やらない**

* WebUI（SSE/REST）はフェーズ2
* PR自動化/外部SaaS連携/厳密コスト計測

---

## アーキテクチャ（MVP）

* **言語/配布**：TypeScript（ESM）＋ `tsup` バンドル、npm CLI

  * Node 18+（推奨 20+/22）
  * `bin`: `splitshot` → `dist/cli/index.js`
* **外部呼び出し**：Codex CLI（`codex exec`）
* **ログ/成果物**：ローカル FS（`./.codex-parallel/`）

---

## コマンド仕様

### 1) `splitshot plan`（構造化計画の生成）

**目的**：Codex `--output-schema` を使い、**Plan JSON** を得る（draft 2020-12 準拠）。

* オプション

  * `--objective <file|text>`（必須）
  * `--workers <n>`（既定 3）
  * `--avoid <globs>` / `--must <globs>`
  * `--approval <suggest|auto|full-auto>`（既定 suggest）
  * `--model <name>`
  * `--planner-home <dir>`（既定 `./.codex-home-planner`）
  * `--codex-bin <path>`（既定 `codex`）
  * `--timeout <ms>`（既定 120000）
  * `--force-schema`（検出をスキップし **強制**で `--output-schema` を使う）

* **機能検出**（更新点）
  `codex exec --help` / `help exec` / `--help` の **stdout+stderr** を総合して
  `--output-schema` / `--json` を検出。`--force-schema` 指定時は検出スキップ。

* **Schema/検証**（更新点）

  * `src/templates/plan.schema.json`（**JSON Schema draft 2020-12**）
  * 検証は **Ajv 2020**（`ajv/dist/2020.js`）を使用

* **出力**

  * STDOUT：Plan JSON（型 `Plan`）
  * 保存：`.codex-parallel/plan-<ts>.json`、`plan.prompt-<ts>.txt`

* **失敗時**

  * JSON 解析失敗／Schema 不一致／Codex 実行失敗は **非0** 終了。
  * エラーメッセージに **生出力**の一部を含める。

**例**

```bash
splitshot plan \
  --objective ./objective.md \
  --workers 3 \
  --approval auto \
  --model gpt-5-codex \
  --force-schema
```

---

### 2) `splitshot assign`

**目的**：Plan を具体の worktree/CODEX_HOME に割当。

* 代表的オプション

  * `--plan <file>`
  * 既存割当：`--map t1=../wt1,t2=../wt2`
  * 自動作成：`--worktree-root ../ --auto-worktree --branch-prefix plan/<id>/`
  * `--codex-home-template "<worktreeDir>/.codex-home-<taskId>"`

* 出力
  `.codex-parallel/assignments-<ts>.json`

---

### 3) `splitshot run`

**目的**：Assignments に沿って Codex を**並列起動**。依存関係/同時上限/競合ガードを適用。

* 代表的オプション

  * `--assign <file>`
  * `--max-parallel <n>`
  * `--auto-isolate`（**同一 `CODEX_HOME` 競合を自動サフィックス付与で回避**）
  * `--codex-args "<...>"`（Codex 追加フラグ）

* 出力（Run ごと）

  * `./.codex-parallel/runs/<runId>/run.meta.json`
  * `./.codex-parallel/runs/<runId>/events.ndjson`
    （`state|stdout|stderr|jsonl` を 1 行 1 JSON で追記）

* 挙動

  * 依存関係：`dependsOn` を尊重（未完了なら待機）
  * 停止処理：Unix=PGIDへ `SIGTERM→SIGKILL`／Windows=`taskkill /T /F`

---

### 4) `splitshot tail`（任意）

* `--run <id|all>`、`--type stdout,stderr,jsonl,state`
* `events.ndjson` を流す簡易ビューア（カラー出力任意）

---

## データモデル／ファイル形式

* **Plan JSON**（`Plan`/`TaskSpec`）
  `meta.objective/workers`、`tasks[].{id,title,summary,cwd,prompt,dependsOn,profile...}`

* **NDJSON（events）** 例

```json
{"t":1737940000123,"type":"state","runId":"t1","data":{"phase":"start","pid":12345}}
{"t":1737940000456,"type":"stdout","runId":"t1","data":{"line":"..."}}
{"t":1737940000789,"type":"jsonl","runId":"t1","data":{"line":"{ \"tool\":\"write_file\" }"}}
{"t":1737940100000,"type":"state","runId":"t1","data":{"phase":"exit","code":0}}
```

---

## ディレクトリ構成（推奨）

```
/src
  /cli        (plan, assign, run, tail)
  /core       (codex, planner, runner, scheduler, tailer, schema, types...)
  /templates  (plan.schema.json)
  /fixtures   (テスト用スタブ等)
/tests
  plan.test.ts
  /fixtures/codex-stub.js
```

---

## 開発・テスト（更新点反映）

* **ESM 方針**：`"type": "module"`、`tsup` 出力は **ESM**、Node 実行は `process.execPath` 経由
* **テスト**：**スタブ Codex 固定**

  * `tests/fixtures/codex-stub.js` を `--codex-bin` に指定
  * 実機 Codex は **手動検証**のみ（CI では使わない、私見）
* **型チェック**：`pnpm typecheck`

  * `tsconfig.typecheck.json`（`noEmit`, `rootDir: "."`, `include: ["src","tests"]`）
* **Lint**：ESLint v9 フラット config（`eslint.config.js`）

  * `pnpm lint`（Prettier 競合 OFF）
* **スクリプト**（例）

  ```json
  {
    "scripts": {
      "build": "tsup",
      "pretest": "pnpm build",
      "test": "vitest run",
      "typecheck": "tsc -p tsconfig.typecheck.json --noEmit",
      "lint": "eslint .",
      "check": "pnpm lint && pnpm typecheck && pnpm test"
    }
  }
  ```

---

## 受け入れ基準（DoD）

* `plan` が **`--output-schema` 前提**で Plan JSON を返し、**Ajv 2020** 検証に通る
* `assign` で Assignments JSON を生成できる（手動/自動 worktree）
* `run` が **N 並列**＋**dependsOn 順序**で起動し、`events.ndjson` を記録
* `CODEX_HOME` 競合を **起動前に検知**、`--auto-isolate` で解決可能
* 異常時は **非0** 終了＋適切なエラーメッセージを出す

---

## 将来（フェーズ2）接続

* CLI の `core` をライブラリ化（`@splitshot/core`）
* HTTP（REST）+ **SSE `/stream`** を追加し、`events.ndjson` を配信
* WebUI は SSE を購読し、Dashboard/History/Run Detail/Plan Assist を提供

---

## 既知のリスクと対応（私見）

* **Codex 側の出力ブレ**：`--output-schema` + Ajv 検証で弾く／`--force-schema` をデバッグ用に
* **Windows/Unix 差**：停止処理は OS 毎に分岐実装
* **巨大ログ**：tailer は行バッファ・逐次書き出しで backpressure 回避

---

必要なら、この仕様を **README.md の冒頭ピッチ＋詳細**に分解した版も作れます。次は `assign` の RED を置いて実装を刻んでいきましょう。
