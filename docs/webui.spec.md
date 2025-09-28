# SplitShot Web UI 仕様書（CLI 連携版 / **Svelte**）

> 最終更新: 2025-09-28（対象CLI: `plan` / `run` / `tail`）
> 目的: 既存2モードCLIに最小のWebアプリを被せ、**プラン作成 → 並列実行 → ライブ可視化** をワンクリックで回す

## 0. 前提と原則

* バックエンドは **既存CLIを子プロセスとして呼び出す**（UIは薄い殻）
* 生成物は **plan-dir**（例: `./.splitshot/plan-<ts>/`）配下に集約（CLI準拠）
* ログ可視化は **`events.ndjson` をSSEで追尾**（標準 200ms）
* **Reactは不使用**。フロントは **Svelte（SvelteKit推奨）** で実装
* **Plan Create** は入力最小化：

  * `codex bin` は **固定で `codex`**（UI入力なし）
  * **Force Schema は常時有効（`--force-schema` 必ず付与）**
  * **timeout は既定値を使用**（UI入力なし）

---

## 1. 画面要件（UX）

### 1.1 ダッシュボード（Plan一覧）

* 目的: `./.splitshot/plan-*` を時系列に一覧。最新 Run 状態も把握
* 列: `planId` / `createdAt` / workers / 最新Runステータス（success/failed/none）
* 行アクション: **詳細** / **実行**
* 右上: **［新規プラン作成］**

### 1.2 新規プラン作成（Plan Create）

* 入力（**簡素化後**）

  * **Objective**: テキスト（複数行） **or** ファイルアップロード（どちらか必須）
  * **Workers**: 数値（既定 2〜3）
  * **Planner Home**: 既定 `./.codex-home-planner`（任意）
* 非表示（固定化）

  * `Codex Bin` → **常に `codex` を使用**
  * `Force Schema` → **常に ON（サーバが `--force-schema` を付ける）**
  * `Timeout` → **CLI既定（120000ms）** を使用（UI入力なし）
* 成功時: 201 `{ planId, planDir }` → Plan詳細へ遷移
* 失敗時: エラー要約（原因+対処ヒント）

### 1.3 Plan詳細

* `manifest.json` 概要（objective / createdAt / workers）
* **チェックリスト一覧**（先頭プレビュー）
* ファイルリンク: `plan.json` / `plan.prompt.txt` / `docs/docs.index.json`
* 実行フォーム:

  * **Max Parallel**（既定 `workers.length`）
  * **CODEX_HOME テンプレ**（既定 `<planDir>/.homes/<workerId>`）
  * **Auto-Isolate**（既定 ON / OFF にすると競合でエラー）
  * **［このプランで実行］** → Run詳細へ

### 1.4 Run詳細（ライブ）

* 概要: `run.meta.json`（`runId`, `maxParallel`, `codexHomes`）
* **ワーカー状態グリッド**: start / exit(code) / blocked（色バッジ）
* **イベントビュー（SSE）**: タブ（All / stdout / stderr / jsonl / state）、worker/type フィルタ、テキスト検索、追尾ON/OFF
* ダウンロード: `events.ndjson` / `run.meta.json`
* 表示上限: クライアント **リングバッファ 5,000行**（超過は古い行を破棄）

---

## 2. 技術スタック

* **フロント**: **SvelteKit**（推奨） + TypeScript

  * ルーティング: `/`（Dashboard）, `/plans/[planId]`（Plan詳細）, `/runs/[runId]`（Run詳細）
  * ストア: `writable` で軽量状態管理
  * SSE: `onMount` で `new EventSource(...)`、クリーンアップで `close()`
* **バックエンド**: Node + Express

  * 子プロセス: `spawn`（`.js`は `process.execPath` 経由、バイナリは直接）
  * ベースディレクトリ: 既定 `./.splitshot`
  * SSE: 200ms ポーリング tail

---

## 3. バックエンドAPI

### 3.1 設定（既定）

```yaml
splitshotBaseDir: "./.splitshot"
pollingIntervalMs: 200
defaultCodexBin: "codex"         # UIからは変更不可。必要ならサーバ設定でのみ上書き可
defaultPlannerHome: ".codex-home-planner"
port: 5174
```

### 3.2 エンドポイント

#### Plans

* `GET /api/plans` → `[{ planId, createdAt, workers, lastRun: { runId, status } }]`

* `GET /api/plans/:planId` → `{ manifest, files: { planJson, planPrompt, docsIndex, checklists[] } }`

* `POST /api/plans`（**入力簡素化済み**）

  * **body**

    ```json
    {
      "objectiveText": "...",     // または multipart の objectiveFile
      "workers": 2,
      "plannerHome": ".codex-home-planner"
    }
    ```
  * **サーバ動作**（固定化ポリシー）

    * objective は **常に tmpfile 化**して CLI に渡す
    * `codex bin` は **固定で `codex`**
    * **`--force-schema` を必ず付けて** `splitshot plan` を実行
    * timeout は **CLI既定**（120s）に任せる（明示指定なし）
  * **201**

    ```json
    { "planId": "plan-1738030000000", "planDir": "/abs/.../plan-1738030000000" }
    ```

* `GET /api/files?planId=<id>&path=<safeRel>` → text/plain（安全化必須）

#### Runs

* `POST /api/runs`

  ```json
  {
    "planId": "plan-1738030000000",
    "maxParallel": 2,
    "codexHomeTemplate": "<planDir>/.homes/<workerId>",
    "autoIsolate": true
  }
  ```

  * サーバは **codex bin = `codex` 固定** で `splitshot run` を呼び出し
  * **201** `{ "runId": "1738031111111", "runDir": "/abs/.../.runs/1738031111111" }`

* `GET /api/runs/:runId/meta?planId=<id>` → `run.meta.json`

* `GET /api/runs/:runId/events/stream?planId=<id>&types=stdout,jsonl&workers=w01,w02&fromStart=1` → **SSE**

---

## 4. 安全性・リソース

* **パス安全化**: `isSafeRelativeUnder(base, rel)` と同等の検証で `..`/絶対/空を拒否
* **SSE 帯域**: サーバ送信キュー上限 1,000行（ドロップ時はヘッダで通知）／クライアント 5,000行リング
* **子プロセス**: `windowsHide: true`、Planの spawn にのみ plannerHome を適用

---

## 5. フロント構成（SvelteKit）

```
apps/web/
  src/routes/+layout.svelte
  src/routes/+page.svelte                 // DashboardPage
  src/routes/plans/[planId]/+page.svelte  // PlanDetailPage
  src/routes/runs/[runId]/+page.svelte    // RunDetailPage
  src/lib/components/PlanTable.svelte
  src/lib/components/WorkerGrid.svelte
  src/lib/components/EventStream.svelte   // SSE購読, タブ/フィルタ/追尾
  src/lib/components/FilePreview.svelte
  src/lib/stores/runEvents.ts             // writable<{ lines: ... }>
```

* **EventStream.svelte**：`onMount(() => { const es = new EventSource(url); es.onmessage = (e)=>append(JSON.parse(e.data)); return ()=>es.close(); })`

---

## 6. フロー

### 6.1 Plan作成

```
UI → POST /api/plans { objectiveText|file, workers, plannerHome }
Server:
  1) objective を tmpfile 化
  2) spawn: splitshot plan --objective <tmp> --workers N --force-schema --codex-bin codex [--planner-home ...]
  3) stdout の { planDir } を parse → planId 抽出
  4) 201 返却
```

### 6.2 Run実行 & 可視化

```
UI → POST /api/runs → { runId }
UI → GET /api/runs/:runId/meta
UI → SSE /api/runs/:runId/events/stream?fromStart=1
Server: events.ndjson を200msでtailし、フィルタ(type/workers)適用して push
```

---

## 7. テスト

* **サーバ単体**: `POST /api/plans`（plan stubで成功）／`POST /api/runs`（runner stubで `.runs/<ts>` 作成）／SSE配信
* **UI E2E**: PlanCreate → PlanDetail → RunDetail（SSE 受信・タブ切替・ダウンロード）
* **大量ログ**: 10万行で固まらない（リングバッファ/仮想リスト）

---

## 8. 受け入れ基準（差分要点）

1. Plan Create 画面に **Codex Bin/Force Schema/Timeout 入力が存在しない**
2. サーバは **常に `--force-schema` 付き、`codex` 固定**で `splitshot plan` を実行
3. Run 実行も **`codex` 固定**（UI入力なし）
4. それでも **全機能（作成/実行/可視化/ダウンロード）が動作**すること

---

## 9. 将来拡張

* Plan再生成、DAG可視化、キャンセル/再実行、通知（Desktop/Slack）、サーバサイド検索最適化


いいね、絵が浮かぶように“文字ワイヤーフレーム + 最小Svelte骨格”でまとめます。余計なオプションは外した版（codex固定/force-schema常時ON/timeout非表示）です。

---

# 画面ワイヤーフレーム（ASCII）

## 1) ダッシュボード `/`

```
┌───────────────────────────────────────────────────────────────┐
│ SplitShot Web UI                                 [ New Plan ] │
│ path: ./.splitshot                                           │
├───────────────────────────────────────────────────────────────┤
│ Plans                                                        │
│ ┌───────┬──────────────────────┬────────┬───────────┬───────┐ │
│ │ Plan  │ Created At           │Workers │ Last Run  │Action │ │
│ │ plan- │ 2025-09-27 11:22:33  │    2   │ success   │[Open] │ │
│ │ plan- │ 2025-09-28 09:10:01  │    3   │ none      │[Open] │ │
│ └───────┴──────────────────────┴────────┴───────────┴───────┘ │
│  ▼ Row hover: Quick actions [Run] [Open]                       │
└───────────────────────────────────────────────────────────────┘
```

### 「New Plan」モーダル

```
┌──────────────── New Plan ────────────────┐
│ Objective (text OR file)                 │
│ [ multiline textarea .................. ]│
│ [ Choose file ]                          │
│ Workers [ 2 ]                            │
│ Planner Home [.codex-home-planner]       │
│                                           │
│ (codex=codex / force-schema=ON 固定)      │
│ [Cancel]                       [ Create ] │
└───────────────────────────────────────────┘
```

---

## 2) プラン詳細 `/plans/[planId]`

```
┌───────────────────────────────────────────────────────────────┐
│ plan-1738030000000                              [ Run this ]   │
├───────────────────────────────────────────────────────────────┤
│ Overview                                                      │
│  Objective   : "……(先頭抜粋)"                                  │
│  Created At  : 2025-09-27T11:22:33Z                            │
│  Workers     : w01, w02                                        │
│  Files       : [plan.json] [plan.prompt.txt] [docs.index.json] │
├───────────────────────────────────────────────────────────────┤
│ Checklists                                                     │
│  ▸ worker-01.md (preview)                                      │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ # Worker 01 — TODO Checklist                              │ │
│  │  … first ~20 lines …                                      │ │
│  └───────────────────────────────────────────────────────────┘ │
│  • worker-02.md                                               │
├───────────────────────────────────────────────────────────────┤
│ Run Settings                                                  │
│  Max Parallel [ 2 ]                                           │
│  CODEX_HOME Template [ <planDir>/.homes/<workerId> ]          │
│  Auto-Isolate [✓]                                             │
│                                [ Run this plan ]              │
└───────────────────────────────────────────────────────────────┘
```

---

## 3) 実行詳細（ライブ） `/runs/[runId]?planId=...`

```
┌───────────────────────────────────────────────────────────────┐
│ Run 1738031111111 (plan-1738030000000)    Status: ● Running   │
│ maxParallel:2  start:11:30:01  last:—                        │
├──────────────── Workers ──────────────────────────────────────┤
│ [w01] ● running   home: .homes/w01-iso-12ab34                 │
│ [w02] ○ queued    home: .homes/w02-iso-98ff20                 │
├──────────────── Events (SSE live) ────────────────────────────┤
│ Tabs: [All] [stdout] [stderr] [jsonl] [state]                 │
│ Filter: worker [w01, w02]  text [ mid ]  Tail [ON]            │
│ ──────────────────────────────────────────────────────────── │
│ 11:30:02  w01  stdout  [w01] hello from stdout 1              │
│ 11:30:02  w01  stderr  [w01] warn from stderr 1               │
│ 11:30:02  w01  jsonl   {"runId":"w01","step":1,...}           │
│ 11:30:03  w01  state   exit code=0                            │
│ 11:30:03  w02  state   start                                  │
│ …                                                             │
│ (showing 5,000 newest lines · 120 lines trimmed)              │
├───────────────────────────────────────────────────────────────┤
│ [ Download events.ndjson ]  [ Download run.meta.json ]        │
└───────────────────────────────────────────────────────────────┘
```

---

# 主要コンポーネントと配置

* `Header`：右上に「New Plan」ボタン（モーダル起動）
* `PlanTable`：ページング/ソート（作成日時 desc デフォルト）
* `PlanFormModal`：Objectiveテキスト/ファイルいずれか必須、Workers、PlannerHome
* `PlanOverviewCard`：manifestの要点＋リンク
* `ChecklistList`：最上位1つプレビュー（全文は `/api/files` 経由で展開）
* `RunSettingsForm`：MaxParallel, CODEX_HOMEテンプレ, Auto-Isolate
* `WorkerGrid`：状態色バッジ（start=青, exit0=緑, exit非0=赤, blocked=灰）
* `EventStream`：SSEクライアント＋リングバッファ（既定5,000行）

---

# 最小Svelte骨格（抜粋）

## EventStream.svelte（SSE購読とリングバッファ）

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  export let streamUrl: string;
  export let types: string[] = [];      // ["stdout","jsonl",...]
  export let workers: string[] = [];    // ["w01","w02"]
  export let tail = true;

  let lines: any[] = [];
  const MAX = 5000;

  function accept(rec: any) {
    if (types.length && !types.includes(rec.type)) return;
    if (workers.length && !workers.includes(rec.runId)) return;
    lines.push({ t: rec.t, runId: rec.runId, type: rec.type, data: rec.data });
    if (lines.length > MAX) lines.splice(0, lines.length - MAX);
    if (tail) queueMicrotask(() => {
      const el = document.getElementById('evt-bottom');
      el && el.scrollIntoView({ behavior: 'instant', block: 'end' });
    });
  }

  let es: EventSource | null = null;
  onMount(() => {
    es = new EventSource(streamUrl);
    es.onmessage = (e) => { try { accept(JSON.parse(e.data)); } catch {} };
  });
  onDestroy(() => es?.close());
</script>

<div class="border rounded p-3 h-[50vh] overflow-auto font-mono text-sm bg-black/90 text-gray-100">
  {#each lines as r}
    <div>
      <span class="opacity-60">{new Date(r.t).toLocaleTimeString()}</span>
      <span class="ml-1 px-1 rounded bg-gray-700">{r.runId}</span>
      <span class="ml-1">{r.type}</span>
      <span class="ml-2">{typeof r.data === 'object' ? JSON.stringify(r.data) : r.data}</span>
    </div>
  {/each}
  <div id="evt-bottom"></div>
</div>
```

## WorkerGrid.svelte（状態バッジ）

```svelte
<script lang="ts">
  export let workers: { id: string; phase: 'queued'|'running'|'exit'|'blocked'; code?: number }[] = [];
  const color = (w) => w.phase==='running' ? 'bg-blue-500'
                 : w.phase==='exit' && w.code===0 ? 'bg-green-600'
                 : w.phase==='exit' ? 'bg-red-600'
                 : 'bg-gray-500';
</script>

<div class="grid grid-cols-2 md:grid-cols-4 gap-2">
  {#each workers as w}
    <div class="rounded px-3 py-2 bg-white/5 border flex items-center gap-2">
      <span class="w-2 h-2 rounded-full {color(w)}"></span>
      <span class="font-semibold">{w.id}</span>
      <span class="text-xs opacity-70">{w.phase}{w.code!==undefined ? ` (${w.code})` : ''}</span>
    </div>
  {/each}
</div>
```

## PlanFormModal.svelte（入力簡素化版）

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  let objectiveText = '';
  let file: File | null = null;
  let workers = 2;
  let plannerHome = '.codex-home-planner';

  async function submit() {
    if (!objectiveText && !file) return alert('Objective text or file is required');
    const form = new FormData();
    if (file) form.append('objectiveFile', file);
    if (objectiveText) form.append('objectiveText', objectiveText);
    form.append('workers', String(workers));
    form.append('plannerHome', plannerHome);
    const res = await fetch('/api/plans', { method: 'POST', body: form });
    if (!res.ok) return alert((await res.text()).slice(0, 1000));
    const j = await res.json();
    dispatch('created', j); // {planId, planDir}
  }
</script>

<div class="p-4 space-y-3">
  <textarea bind:value={objectiveText} class="w-full h-32" placeholder="Objective (or attach file)"></textarea>
  <input type="file" on:change={(e:any)=>file=e.currentTarget.files?.[0]||null} />
  <div class="flex gap-3">
    <label>Workers <input type="number" min="1" bind:value={workers} class="w-20"/></label>
    <label>Planner Home <input type="text" bind:value={plannerHome} class="w-64"/></label>
  </div>
  <div class="flex justify-end gap-2">
    <button class="btn" on:click={()=>dispatch('cancel')}>Cancel</button>
    <button class="btn btn-primary" on:click={submit}>Create</button>
  </div>
  <p class="text-xs opacity-70">codex=codex / force-schema=ON / timeout=default</p>
</div>
```

---

# レイアウト/スタイルのコツ（短冊）

* **情報密度**：上から「概要 → 操作 → ログ」。主要操作は常に右上に固定（New Plan / Run this）
* **色**：背景ダーク、テキスト淡色、状態バッジで一目
* **可読性**：等幅フォントでstdout/stderr/jsonlを区別、JSONはワンクリック整形（後続対応可）
* **パフォーマンス**：リストは仮想化不要な範囲に抑え、5,000行リング＋トリム表示
* **レスポンシブ**：WorkerGridは `grid-cols-2 → md:grid-cols-4`、イベント領域は `h-[50vh]` 固定

---
