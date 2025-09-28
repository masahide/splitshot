# SplitShot — Two‑Mode CLI (Plan / Parallel Run)

SplitShot is a tiny CLI that **plans software work** with an LLM (Codex-compatible) and then **executes the plan in parallel** using human‑readable checklists as the unit of work. In day‑to‑day use, you only need **two commands**:

1. `splitshot plan …` → generate **N checklists** and a **manifest** under a per‑run **plan directory**
2. `splitshot run` → execute those checklists **in parallel**, collect logs, and emit **events**

A third helper command, `splitshot tail`, makes it easy to follow aggregated logs.

---

## Why SplitShot?

* **Minimal UX**: simple 2‑step operation—generate → run
* **Human‑first artifacts**: checklists are Markdown and easy to read/review
* **Observability built‑in**: line‑level stdout/stderr, structured JSONL following, and state transitions as NDJSON events

Non‑goals (v1): rich DAG resource management (we guarantee order inside a worker stream), automatic `git worktree` creation (can be scripted on top).

---

## Requirements

* Node.js 18+ (tested on modern LTS)
* A Codex‑compatible binary on `$PATH` (default command is `codex`). For development you can stub it with your own `*.js` runner.

---

## Quick Start

```bash
# 1) Plan: create docs/ deliverables + N worker checklists + manifest under ./.splitshot/plan-<ts>/
splitshot plan --objective README.md --workers 3

# 2) Run: pick the latest plan-dir automatically and execute in parallel
splitshot run

# Tail logs (stdout + jsonl only)
splitshot tail --type stdout,jsonl
```

> Tip: You can always pass the directory explicitly: `splitshot run --plan-dir ./.splitshot/plan-<ts>/`.

---

## Directory Layout (Artifacts)

When you run the **plan** command, SplitShot creates a dedicated **plan directory**:

```
.splitshot/plan-<timestamp>/
  plan.json                 # validated plan (generatedFiles[] + tasks)
  manifest.json             # entrypoint used by `run` (includes docsIndex)
  plan.prompt.txt           # exact prompt we sent to Codex (reproducibility)
  docs/
    docs.index.json         # metadata for generated files (exists/bytes/sha256)
    interface.md
    worker-task/
      01/todo.md
  checklists/
    worker-01.md
    worker-02.md
    ...
  .runs/
    latest.json             # { "runDir": "/abs/path" }
    <run-ts>/
      events.ndjson         # observability stream
      run.meta.json         # { workers, maxParallel, codexHomes }
  .homes/
    w01/ ... (CODEX_HOME per worker)
    w02/ ...
```

---

## Commands

### 1) `splitshot plan`

```
splitshot plan \
  --objective <file|text> \
  --workers <N> \
  [--codex-bin <path>] \
  [--out <dir>] \
  [--planner-home <dir>]
```

**Required**

* `--objective` — plain text or a file path
* `--workers` — how many parallel worker checklists to generate

**Common options**

* `--codex-bin` — Codex binary or JS script (`codex` by default)
* `--out` — explicit output dir (defaults to `./.splitshot/plan-<timestamp>/`)

**Behavior**

* Detects Codex flags (`--output-schema`, `--output-last-message`, `--json`) when possible
* Fetches **Plan JSON** conforming to `src/schemas/plan.ts` / `src/templates/plan.zod.ts`
* Runs Codex inside the freshly-created plan-dir (`--cd <planDir>`) so that `docs/` files are written on disk
* Computes `docs/docs.index.json` with `{ path, role, workerId, exists, bytes, sha256, validPath }`
* Distributes tasks (topological order) across **N** worker streams (round‑robin)
* Emits one Markdown **checklist** per worker and a **manifest**

**Checklist template (example)**

```md
# Worker 01 — TODO Checklist

## Context
<summary or excerpt of objective>

## Tasks
- [ ] t1: Bootstrap runner
  - Summary: ...
  - Acceptance: ...
- [ ] t3: Tail command
  - Summary: ...
  - Acceptance: ...

## Notes
- Keep outputs line‑oriented (stdout/jsonl)
- Report key metrics at the end
```

**Manifest (example)**

```json
{
  "version": 1,
  "objective": "<string>",
  "createdAt": "2025-09-27T11:22:33Z",
  "docsIndex": "docs/docs.index.json",
  "workers": [
    {
      "id": "w01",
      "checklist": "checklists/worker-01.md",
      "todo": "docs/worker-task/01/todo.md"
    },
    {
      "id": "w02",
      "checklist": "checklists/worker-02.md",
      "todo": "docs/worker-task/02/todo.md"
    }
  ]
}
```

The command prints a small JSON to stdout: `{ "planDir": "<abs path>" }`.

---

### 2) `splitshot run`

```
splitshot run \
  [--plan-dir <dir>] \
  [--codex-bin <path>] \
  [--max-parallel <N>] \
  [--no-auto-isolate] \
  [--codex-home-template "<planDir>/.homes/<workerId>"]
```

**Defaults**

* `--plan-dir` — the latest `./.splitshot/plan-*/` is auto‑selected
* `--codex-bin` — `codex`
* `--max-parallel` — number of workers (`manifest.workers.length`)
* Auto‑isolation **enabled**: if two workers would share the same `CODEX_HOME`, a unique suffix `-iso-<short>` is appended.

**What it does**

* Reads `manifest.json` and executes each worker **in parallel**:

  * Assembles the Codex prompt from `checklists/worker-XX.md` and runs `codex exec --json -- "<prompt>"`
  * Working directory: `<plan-dir>`
  * Environment:

    * `CODEX_HOME=<plan-dir>/.homes/<workerId>` (with auto‑isolation suffix if needed)
    * `SPLITSHOT_RUN_ID=<workerId>`
    * `SPLITSHOT_CHECKLIST_FILE=<abs path to md>`
* **Log collection**:

  * Captures `stdout` / `stderr` line‑by‑line
  * Follows `$CODEX_HOME/sessions/**/rollout-*.jsonl` every 200ms, including files that appear later
* **State events**:

  * Records `state:start` and `state:exit(code)` for each worker
  * (Planned) record `state:blocked` for workers skipped due to failed dependencies
* **Outputs** under `<plan-dir>/.runs/<ts>/`:

  * `events.ndjson`, `run.meta.json`, and a `latest.json` pointer

**Exit codes**

* `0` if all workers succeed
* `1` if any worker fails

**Advanced**

* `--no-auto-isolate` — disable isolation; on conflicting `CODEX_HOME` the command exits with an error
* `--codex-home-template` — override `CODEX_HOME` pattern; placeholders: `<planDir>`, `<workerId>`
* JS runner support: if `--codex-bin` ends with `.js`, SplitShot spawns it via `process.execPath` (Node.js)

---

### 3) `splitshot tail`

```
splitshot tail \
  [--plan-dir <dir>] \
  [--run <id|all>] \
  [--type stdout,stderr,jsonl,state] \
  [--duration <ms>] \
  [--events <file>]        # test/debug helper
```

* By default it reads the **latest run** under the given `--plan-dir` (or the latest plan dir if omitted).
* With `--duration`, it **follows** new lines; otherwise it prints current contents and exits.

---

## Events (NDJSON) Format

Each line of `<runDir>/events.ndjson` is one JSON object:

```json
{"t": 1738020000000, "type": "state",  "runId": "w01", "data": {"phase": "start"}}
{"t": 1738020000100, "type": "stdout", "runId": "w01", "data": {"line": "..."}}
{"t": 1738020000200, "type": "jsonl",  "runId": "w01", "data": {"line": "{\"step\":1}"}}
{"t": 1738020000300, "type": "state",  "runId": "w01", "data": {"phase": "exit", "code": 0}}
{"t": 1738020000400, "type": "state",  "runId": "w02", "data": {"phase": "blocked", "reason": "dependency_failed"}}
```

Types:

* `state` — `{ phase: "start" | "exit"; code? }` (and soon `blocked`)
* `stdout` / `stderr` — human text, line‑oriented
* `jsonl` — raw JSONL lines found under `$CODEX_HOME/sessions/**/rollout-*.jsonl`

---

## Migration Notes

The old **`assign`** command is deprecated in the two‑mode flow. The new flow pivots on **checklists** and the **manifest** in a plan directory. If you still need `git worktree` orchestration, script it externally using `manifest.json` as the source of truth.

---

## Troubleshooting

* **“codex does not support --output-schema”**: Your Codex binary might not expose the expected flags; pass `--force-schema` (if you kept the detection gate) or use a stub while testing.
* **“Duplicate CODEX_HOME detected …”**: Either keep the default auto‑isolation, or specify `--codex-home-template` to avoid collisions, or run with `--no-auto-isolate` to fail loudly.
* **Nothing in `events.ndjson`**: Make sure your runner prints something to stdout/stderr, and that it writes JSONL files under `$CODEX_HOME/sessions/**/` during execution.

---

## Development

```bash
pnpm i
pnpm build
pnpm test
```

Key internals:

* **Planner** prompt builder and JSON Schema validation (`src/templates/plan.schema.json`)
* **Scheduler** groups tasks in topological layers (for distribution)
* **Events**: small writer with `cork()/uncork()` batching; JSONL follower that periodically scans for new files and resumes from last read positions

