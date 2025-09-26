import { execa } from "execa";
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Assignments, Assignment } from "../src/core/types"; // ← 型を使う

const root = process.cwd();
const cli = path.resolve("dist/cli/index.js");

beforeAll(async () => {
    expect(fs.existsSync(cli)).toBe(true);
});

describe("splitshot assign", () => {
    it("maps tasks to worktrees and emits assignments.json", async () => {
        const planPath = path.resolve("tests/fixtures/plan-min.json");
        const { stdout } = await execa(process.execPath, [
            cli,
            "assign",
            "--plan", planPath,
            "--map", "t1=../wt1,t2=../wt2",
            "--codex-home-template", "<worktreeDir>/.codex-home-<taskId>",
        ]);

        const data: Assignments = JSON.parse(stdout);           // ← 型付け
        expect(Array.isArray(data.assignments)).toBe(true);

        const a1 = data.assignments.find((a: Assignment) => a.taskId === "t1");
        expect(a1).toBeTruthy();
        expect(a1!.worktreeDir.endsWith("../wt1")).toBe(true);
        expect(a1!.codexHome.endsWith("../wt1/.codex-home-t1")).toBe(true);

        const a2 = data.assignments.find((a: Assignment) => a.taskId === "t2");
        expect(a2).toBeTruthy();
        expect(a2!.worktreeDir.endsWith("../wt2")).toBe(true);
        expect(a2!.codexHome.endsWith("../wt2/.codex-home-t2")).toBe(true);

        const files = fs.readdirSync(path.join(root, ".codex-parallel"));
        expect(files.some((f) => f.startsWith("assignments-") && f.endsWith(".json"))).toBe(true);
    });
});
