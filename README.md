# SplitShot v2 — Stepwise Codex CLI

SplitShot is a CLI toolkit that automates a modern Codex-driven workflow: generate project prompts, mint working docs, prepare prompts for each worker, spin up Git worktrees, run Codex checklists in parallel, integrate the results, and clean everything up. v2 replaces the old `plan` command with explicit step commands so each artefact is visible and testable.

```
splitshot prompts up
splitshot step1 spec --objective docs/spec.objective.md
splitshot step2 design
splitshot step3 gen-prompts
splitshot worktrees up --count 3 --base ../worktrees-v2
splitshot run --max-parallel 3
splitshot integrate
splitshot cleanup --force
```

Along the way you get structured artefacts (`docs/`, `.splitshot/plan-*/manifest.v3.json`, `.homes`, `.runs`), and `splitshot tail` lets you follow `events.ndjson` output live.

---

## Requirements

- Node.js 18+
- A Codex-compatible CLI (`codex` by default). For testing you can reuse the stubs under `tests/fixtures/`.

---

## Workflow Overview

1. **Install prompts** – `splitshot prompts up` copies prompt templates from `src/templates/prompts/default/` to your `CODEX_HOME`.
2. **Step1 (spec)** – `splitshot step1 spec --objective docs/spec.objective.md` renders the spec prompt and calls Codex to produce `docs/spec.md`, updating `docs/docs.index.json`.
3. **Step2 (design)** – `splitshot step2 design` produces interface docs and agent TODOs under `docs/todo/`.
4. **Step3 (gen-prompts)** – parses TODO markdown + interface docs and creates `.splitshot/plan-*/manifest.v3.json`, worker checklists, and per-worker `CODEX_HOME` directories.
5. **Worktrees** – `splitshot worktrees up --count N --base ../worktrees-v2` provisions Git worktrees and records them in the manifest.
6. **Run** – `splitshot run --max-parallel N` reads `manifest.v3.json`, runs each checklist through Codex in parallel, and emits `.runs/<ts>/events.ndjson` + `latest.json`.
7. **Integrate** – `splitshot integrate` commits/pushes each worktree branch and calls `gh pr create` (or prints manual commands when `gh` is unavailable).
8. **Cleanup** – `splitshot cleanup [--force]` removes worktrees/branches once they are merged.
9. **Tail** – `splitshot tail --plan-dir <plan>` (or `--events <file>`) follows NDJSON events with optional filters (`--run`, `--type`).

Every step is idempotent and easy to test. The main artefacts live under:

```
.splitshot/plan-<timestamp>/
  manifest.v3.json
  checklists/worker-01.md
  .homes/w01 (per-worker CODEX_HOME)
  .runs/<run-ts>/events.ndjson
  docs/
    docs.index.json
    spec.md
    interface.md
    todo/agent-a.md ...
```

---

## CLI Help

```
splitshot --help
```

Lists the available commands:

- `prompts`
- `step1`
- `step2`
- `step3`
- `worktrees`
- `run`
- `integrate`
- `cleanup`
- `tail`

Each subcommand supports `--help` for detailed options. For example:

```
splitshot step1 spec --help
splitshot run --help
```

---

## Development

- `pnpm install`
- `pnpm build`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

Use the provided stubs in `tests/fixtures/` (`fake-codex.js`, `fake-git.js`, `fake-gh.js`) to keep tests hermetic.

---

## License

MIT
