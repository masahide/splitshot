# Gemini Code Assistant Context

## Project Overview

This project, named "splitshot," is a command-line interface (CLI) tool built with Node.js and TypeScript. Its primary purpose is to automate software development tasks by leveraging a Codex-compatible Large Language Model (LLM). The workflow is divided into two main stages:

1.  **Planning (`splitshot plan`):** The user provides an objective (a high-level description of the task). The tool then uses the LLM to generate a detailed plan, which includes a set of "checklists" (in Markdown format) for individual workers and a `manifest.json` file that orchestrates the work.

2.  **Execution (`splitshot run`):** The tool reads the manifest and executes the checklists in parallel, using the LLM to perform the tasks described in each checklist. It captures logs and events from the execution process.

The project also includes a `splitshot tail` command for monitoring the logs generated during the execution phase.

## Building and Running

The project uses `pnpm` as its package manager. The following commands are essential for development and execution:

*   **Installation:**
    ```bash
    pnpm install
    ```

*   **Building:** The project is written in TypeScript and needs to be compiled into JavaScript.
    ```bash
    pnpm build
    ```

*   **Running Tests:** The project uses `vitest` for testing.
    ```bash
    pnpm test
    ```

*   **Linting and Type-Checking:**
    ```bash
    pnpm lint
    pnpm typecheck
    ```

*   **Running the CLI (after building):**
    ```bash
    node dist/cli/index.js <command> [options]
    ```
    For example:
    ```bash
    node dist/cli/index.js plan --objective-file objective.md --workers 2
    node dist/cli/index.js run
    ```

## Development Conventions

*   **Code Style:** The project uses Prettier for code formatting and ESLint for linting. The configuration files (`.prettierrc`, `.eslintrc.cjs`, `eslint.config.js`) define the code style.
*   **Testing:** The project has a comprehensive test suite in the `tests/` directory. Tests are written using `vitest`.
*   **Modularity:** The code is organized into modules under the `src/` directory. The core logic is separated from the CLI-specific code.
*   **Error Handling:** The project has a dedicated module for error handling (`src/core/errors.ts`).
*   **Schemas:** The project uses Zod for schema definition and validation, particularly for the `plan.json` file.
