import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const cli = path.resolve("dist/cli/index.js");
const plan = path.resolve("tests/fixtures/plan-min.json");
const stub = path.resolve("tests/fixtures/codex-runner-stub.js");

function mkTmp(prefix: string) {
    return fs.mkdtempSync(path.join(tmpdir(), prefix));
}
function readLines(p: string) {
    return fs.readFileSync(p, "utf8").trim().split(/\r?\n/).filter(Boolean);
}

describe("run: CODEX_HOME conflicts", () => {
    it("fails without --auto-isolate", () => {
        const work = mkTmp("splitshot-conf-");
        const shared = path.join(work, ".home-shared");
        const asn = {
            assignments: [
                { taskId: "t1", worktreeDir: path.join(work, "wt1"), codexHome: shared },
                { taskId: "t2", worktreeDir: path.join(work, "wt2"), codexHome: shared },
            ],
        };
        const asnFile = path.join(work, "assign.json");
        fs.writeFileSync(asnFile, JSON.stringify(asn, null, 2));

        const out = spawnSync(process.execPath, [
            cli,
            "run",
            "--plan",
            plan,
            "--assignments",
            asnFile,
            "--codex",
            stub,
            "--max-parallel",
            "2",
        ], { cwd: root });

        expect(out.status).not.toBe(0);
        const err = (out.stderr || Buffer.alloc(0)).toString();
        expect(err).toMatch(/Duplicate CODEX_HOME/i);
    });

    it("succeeds with --auto-isolate and both tasks start", () => {
        const work = mkTmp("splitshot-auto-");
        const shared = path.join(work, ".home-shared");
        const asn = {
            assignments: [
                { taskId: "t1", worktreeDir: path.join(work, "wt1"), codexHome: shared },
                { taskId: "t2", worktreeDir: path.join(work, "wt2"), codexHome: shared },
            ],
        };
        const asnFile = path.join(work, "assign.json");
        fs.writeFileSync(asnFile, JSON.stringify(asn, null, 2));

        const out = spawnSync(process.execPath, [
            cli,
            "run",
            "--plan",
            plan,
            "--assignments",
            asnFile,
            "--codex",
            stub,
            "--max-parallel",
            "2",
            "--auto-isolate",
        ], { cwd: root });

        expect(out.status, String(out.stderr)).toBe(0);

        const latest = JSON.parse(fs.readFileSync(path.join(work, ".codex-parallel", "runs", "latest.json"), "utf8"));
        const lines = readLines(path.join(latest.runDir, "events.ndjson"));
        const starts = lines.map((l) => JSON.parse(l)).filter((e) => e.type === "state" && e.data?.phase === "start").map((e) => e.runId);
        expect(new Set(starts)).toEqual(new Set(["t1", "t2"]));
    });
});
