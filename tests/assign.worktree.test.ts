import { execa } from "execa";
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { Assignments, Assignment } from "../src/core/types";
import type { WorktreeAddCommand } from "../src/core/git";

const cli = path.resolve("dist/cli/index.js");
const plan = path.resolve("tests/fixtures/plan-min.json");

function mkTmp(prefix: string) {
    return fs.mkdtempSync(path.join(tmpdir(), prefix));
}
// 画面出力(JSON)の型：assignments に加えて git.worktreeAdd を持つ場合がある
type AssignOut = Assignments & { git?: { worktreeAdd?: WorktreeAddCommand[] } };

describe("splitshot assign --worktree-root/--auto-worktree/--branch-prefix", () => {
    it("generates worktree paths from --worktree-root and emits git worktree add commands when --auto-worktree", async () => {
        const work = mkTmp("splitshot-assign-wt-");
        const wtRoot = path.join(work, "wts");

        const { stdout, exitCode } = await execa(process.execPath, [
            cli,
            "assign",
            "--plan", plan,
            "--worktree-root", wtRoot,
            "--auto-worktree",
            "--branch-prefix", "splitshot/",
            "--codex-home-template", "<worktreeDir>/.codex-home-<taskId>",
        ]);

        expect(exitCode).toBe(0);
        const out: AssignOut = JSON.parse(stdout);

        // assignments: worktreeDir は <root>/<taskId>
        const a1 = out.assignments.find((a: Assignment) => a.taskId === "t1");
        const a2 = out.assignments.find((a: Assignment) => a.taskId === "t2");
        if (!a1 || !a2) throw new Error("assignments for t1/t2 not found");
        expect(a1.worktreeDir).toBe(path.join(wtRoot, "t1"));
        expect(a2.worktreeDir).toBe(path.join(wtRoot, "t2"));

        // git コマンドが2本出力される
        expect(out.git?.worktreeAdd?.length).toBe(2);

        // そのまま型付きで扱う
        const cmds: WorktreeAddCommand[] = out.git?.worktreeAdd ?? [];

        // 形だけでなく、branch と path が正しいかをチェック
        const c1 = cmds.find((c: WorktreeAddCommand) => c.args.includes(path.join(wtRoot, "t1")));
        const c2 = cmds.find((c: WorktreeAddCommand) => c.args.includes(path.join(wtRoot, "t2")));
        if (!c1 || !c2) throw new Error("generated git worktree add commands not found");

        // git worktree add -B splitshot/<taskId> <path> HEAD
        for (const c of [c1, c2]) {
            expect(c.cmd).toBe("git");
            expect(c.args.slice(0, 2)).toEqual(["worktree", "add"]);
            const hasB = c.args.includes("-B");
            expect(hasB).toBe(true);
            const bIdx = c.args.indexOf("-B");
            expect(c.args[bIdx + 1]).toMatch(/^splitshot\/t[12]$/);
            expect(c.args.at(-1)).toBe("HEAD");
        }
    });

    it("does not emit git commands without --auto-worktree (but still maps worktree paths)", async () => {
        const work = mkTmp("splitshot-assign-wt-");
        const wtRoot = path.join(work, "wts");

        const { stdout, exitCode } = await execa(process.execPath, [
            cli,
            "assign",
            "--plan", plan,
            "--worktree-root", wtRoot,
            "--codex-home-template", "<worktreeDir>/.codex-home-<taskId>",
        ]);

        expect(exitCode).toBe(0);
        const out: AssignOut = JSON.parse(stdout);

        const a1 = out.assignments.find((a: Assignment) => a.taskId === "t1");
        const a2 = out.assignments.find((a: Assignment) => a.taskId === "t2");
        if (!a1 || !a2) throw new Error("assignments for t1/t2 not found");
        expect(a1.worktreeDir).toBe(path.join(wtRoot, "t1"));
        expect(a2.worktreeDir).toBe(path.join(wtRoot, "t2"));
        expect(out.git?.worktreeAdd).toBeUndefined();
    });

    it("respects --map overrides even with --worktree-root", async () => {
        const work = mkTmp("splitshot-assign-wt-");
        const wtRoot = path.join(work, "wts");

        const { stdout, exitCode } = await execa(process.execPath, [
            cli,
            "assign",
            "--plan", plan,
            "--map", `t1=${path.join(wtRoot, "override1")}`,
            "--worktree-root", wtRoot,
            "--auto-worktree",
            "--branch-prefix", "wip/",
            "--codex-home-template", "<worktreeDir>/.codex-home-<taskId>",
        ]);

        expect(exitCode).toBe(0);
        const out: AssignOut = JSON.parse(stdout);

        const a1 = out.assignments.find((a: Assignment) => a.taskId === "t1");
        const a2 = out.assignments.find((a: Assignment) => a.taskId === "t2");
        if (!a1 || !a2) throw new Error("assignments for t1/t2 not found");

        // t1 は map の値を優先
        expect(a1.worktreeDir).toBe(path.join(wtRoot, "override1"));
        // t2 は root からの自動
        expect(a2.worktreeDir).toBe(path.join(wtRoot, "t2"));

        // git コマンドは branch-prefix が wip/
        const c1 = out.git?.worktreeAdd?.find((c: WorktreeAddCommand) =>
            c.args.includes(path.join(wtRoot, "override1"))
        );
        const c2 = out.git?.worktreeAdd?.find((c: WorktreeAddCommand) =>
            c.args.includes(path.join(wtRoot, "t2"))
        );
        if (!c1 || !c2) throw new Error("generated git worktree add commands not found");
        const bIdx1 = c1.args.indexOf("-B");
        const bIdx2 = c2.args.indexOf("-B");
        expect(c1.args[bIdx1 + 1]).toBe("wip/t1");
        expect(c2.args[bIdx2 + 1]).toBe("wip/t2");
    });
});