# Repository Guidelines

## Project Structure & Module Organization
- `src/cli/` hosts the entry commands (`plan`, `run`, `tail`); `src/core/` contains the scheduler, planner, and event systems used by every command.
- `src/templates/` stores the checklist and schema assets shared during planning, while `src/schemas/` captures runtime validation helpers.
- Tests live in `tests/`, with `tests/fixtures/` providing Codex stubs and sample plans; keep new fixtures small and deterministic.
- Build artifacts land in `dist/cli/`. Anything under `dist/` is generated and should not be edited by hand.

## Build, Test, and Development Commands
- `pnpm build` → bundles the CLI with `tsup`; run before publishing.
- `pnpm test` → executes the Vitest suite once; `pnpm dev` watches for changes.
- `pnpm lint` and `pnpm typecheck` enforce ESLint + TypeScript constraints; `pnpm check` runs lint, typecheck, and tests together.
- `pnpm format` applies Prettier across the workspace; use it before large refactors.

## Coding Style & Naming Conventions
- Code is TypeScript-first (ES modules). Stick to 2-space indentation and avoid implicit `any`.
- Prefer descriptive file names (`runner.ts`, `eventsWriter.ts`) and PascalCase for exported types; internal helpers may stay camelCase.
- ESLint extends the recommended JS/TS configs with Prettier harmonization (`eslint.config.js`); honor existing suppression patterns instead of adding new globals.

## Testing Guidelines
- Write Vitest specs beside similar coverage in `tests/`. Mirror the command name (`run.e2e.test.ts`) for new suites.
- Favor arranging fixtures under `tests/fixtures/<feature>/` and document assumptions inline.
- Aim to cover both plan creation and run execution paths when touching shared modules; add regression tests when fixing bugs.

## Commit & Pull Request Guidelines
- Follow conventional commit prefixes (`feat:`, `fix:`, `chore:`); short descriptions may be Japanese or English, but stay action-oriented.
- Group related changes per commit and include reproduction notes or CLI snippets in the PR body (`splitshot plan --objective ...`).
- Reference issues where applicable and attach artifacts (e.g., checklist samples or log excerpts) when behavior changes.

## Environment & Operational Notes
- Development targets Node.js ≥ 18 with `pnpm` (see `package.json`). Run `pnpm install` before building.
- エージェントからの応答は必ず日本語で行うこと。
- When testing `splitshot run`, point Codex-related flags to local stubs from `tests/fixtures/` to avoid external dependencies.
