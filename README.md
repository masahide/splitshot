# SplitShot (CLI MVP)

A minimal CLI to run Codex **in parallel** across a plan: **plan → assign → run → log**.
Stack: Node.js + TypeScript / ESM / pnpm / tsup / vitest.

## Requirements

* Node.js 18+
* pnpm

## Quick Start

```bash
pnpm i
pnpm build
pnpm test
```

Works with local stubs. Real Codex is optional.

## Project Structure

```
/src
  /cli        plan.ts assign.ts run.ts tail.ts index.ts
  /core       codex.ts planner.ts schema.ts scheduler.ts runner.ts git.ts types.ts
  /templates  plan.schema.json
/tests
  *.test.ts
  /fixtures   codex-stub.js            # for plan
             codex-runner-stub.js      # for run
```

## Features

* **plan**: Generate a structured plan via Codex `--output-schema` + `--json`, validated by Ajv 2020-12
* **assign**: Map tasks to worktrees. `--codex-home-template` for `CODEX_HOME` expansion
  Extras: `--worktree-root` / `--auto-worktree` / `--branch-prefix` to **emit `git worktree add` commands** (not executed)
* **run**:

  * Layered execution of a DAG via `buildBatches`
  * `--max-parallel` concurrency
  * Process spawn (`.js` runners via `process.execPath`), `cwd=worktreeDir`, `env.CODEX_HOME`
  * **CODEX_HOME conflict detection**; `--auto-isolate` appends `-iso-<uniq>` suffix
  * Line-by-line capture of `stdout`/`stderr` to `events.ndjson`
  * Polling ingest of `$CODEX_HOME/sessions/**/rollout-*.jsonl` (handles late-arriving files)
  * **Failure propagation**: dependents are recorded as `blocked` when a dependency fails
  * Exit code: non-zero if any task fails
* **tail**: Filter/follow `events.ndjson`
  `--run <id|all>` / `--type stdout,stderr,jsonl,state` / `--duration <ms>` / `--events <path>`

## Data Formats

### Plan

```ts
type Plan = {
  meta?: { objective?: string; workers?: number };
  tasks: {
    id: string; title: string; summary: string; cwd: string; prompt: string;
    dependsOn?: string[];
    profile?: { model?: string; approval?: "suggest" | "auto" | "full-auto" };
  }[];
}
```

Schema: `src/templates/plan.schema.json` (draft 2020-12)

### Assignments

```ts
type Assignments = {
  planId?: string;
  assignments: {
    taskId: string;
    worktreeDir: string;
    codexHome: string;
    profile?: { model?: string; approval?: "suggest" | "auto" | "full-auto" };
  }[];
}
```

### Events (NDJSON)

```json
{"t":1738020000000,"type":"state","runId":"t1","data":{"phase":"start"}}
{"t":1738020000500,"type":"stdout","runId":"t1","data":{"line":"hello"}}
{"t":1738020001000,"type":"jsonl","runId":"t1","data":{"line":"{\"step\":1}"}}
{"t":1738020001500,"type":"state","runId":"t2","data":{"phase":"blocked","reason":"dependency_failed","deps":["t1"]}}
{"t":1738020002000,"type":"state","runId":"t1","data":{"phase":"exit","code":0}}
```

## CLI Examples

### plan

```bash
node dist/cli/index.js plan \
  --objective "Refactor the repo to add SplitShot" \
  --workers 3 \
  --codex-bin tests/fixtures/codex-stub.js \
  > plan.json
```

Artifacts (project root): `.codex-parallel/plan-*.json`, `plan.prompt-*.txt`

### assign (explicit map)

```bash
node dist/cli/index.js assign \
  --plan tests/fixtures/plan-min.json \
  --map t1=../wt1,t2=../wt2 \
  --codex-home-template "<worktreeDir>/.codex-home-<taskId>" \
  > assignments.json
```

### assign (emit worktree commands)

```bash
node dist/cli/index.js assign \
  --plan tests/fixtures/plan-min.json \
  --worktree-root ./wts \
  --auto-worktree \
  --branch-prefix splitshot/ \
  --codex-home-template "<worktreeDir>/.codex-home-<taskId>" \
  > assignments.json
```

The output includes `git.worktreeAdd[]` (not executed).

### run

```bash
node dist/cli/index.js run \
  --plan tests/fixtures/plan-min.json \
  --assignments /tmp/work/assignments.json \
  --codex tests/fixtures/codex-runner-stub.js \
  --max-parallel 2 \
  --auto-isolate
```

Outputs are **anchored at the assignments file directory**:

```
<assignmentsDir>/.codex-parallel/
  runs/
    latest.json              # { runDir: "<abs path>" }
    <ts>/
      events.ndjson
      run.meta.json          # { planId?, codexHomes{}, maxParallel }
```

### tail

```bash
node dist/cli/index.js tail --run all --type stdout,jsonl
node dist/cli/index.js tail --run t1  --type stdout --duration 300
node dist/cli/index.js tail --events /path/to/events.ndjson --type state
```

## Testing

```bash
pnpm test
# or
vitest tests/run.e2e.test.ts
```

Stubs:

* `tests/fixtures/codex-stub.js` (plan)
* `tests/fixtures/codex-runner-stub.js` (run; set `SPLITSHOT_FORCE_FAIL_TASK_IDS="t1,tX"` to force failures)

## Implementation Notes

* ESM only (external ESM requires explicit extensions; Ajv import is `ajv/dist/2020.js`)
* Scheduler: `buildBatches()` layers the DAG and detects cycles
* Concurrency: simple semaphore for `--max-parallel`
* JSONL ingestion: polls `$CODEX_HOME/sessions/**/rollout-*.jsonl` and handles new files
* I/O: `events.ndjson` write uses `cork()/uncork()` every 200 lines
* Runner: `.js` runners spawn via `process.execPath`; `cwd=worktreeDir`
* Exit code: 0 if all succeed; 1 if any task fails


## Contributing

PRs and issues are welcome. Add tests in RED → GREEN → REFACTOR order.
