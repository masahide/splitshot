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
    const p = fs.mkdtempSync(path.join(tmpdir(), prefix));
    return p;
}
function readLines(p: string) {
    return fs.readFileSync(p, "utf8").trim().split(/\r?\n/).filter(Boolean);
}

describe("run (E2E): dependsOn + maxParallel=1", () => {
    it("respects dependsOn order and emits events.ndjson", () => {
        const work = mkTmp("splitshot-e2e-");
        const asn = {
            assignments: [
                { taskId: "t1", worktreeDir: path.join(work, "wt1"), codexHome: path.join(work, ".home-t1") },
                { taskId: "t2", worktreeDir: path.join(work, "wt2"), codexHome: path.join(work, ".home-t2") },
            ],
        };
        const asnFile = path.join(work, "assignments.json");
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
            "1",
        ], { cwd: root });

        expect(out.status, String(out.stderr)).toBe(0);

        const latest = JSON.parse(
            fs.readFileSync(path.join(work, ".codex-parallel", "runs", "latest.json"), "utf8")
        );
        const ev = readLines(path.join(latest.runDir, "events.ndjson")).map((l) => JSON.parse(l));

        const starts = ev.filter((e) => e.type === "state" && e.data?.phase === "start").map((e) => e.runId);
        // t1 が先、t2 が後
        expect(starts[0]).toBe("t1");
        expect(starts[1]).toBe("t2");
    });
});
