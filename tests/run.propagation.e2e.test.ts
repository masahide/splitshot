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

describe("run: failure propagation", () => {
    it("marks dependent tasks as blocked and exits non-zero", () => {
        const work = mkTmp("splitshot-prop-");
        const asn = {
            assignments: [
                { taskId: "t1", worktreeDir: path.join(work, "wt1"), codexHome: path.join(work, ".home-t1") },
                { taskId: "t2", worktreeDir: path.join(work, "wt2"), codexHome: path.join(work, ".home-t2") }, // dependsOn: t1 (plan-min側)
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
            "1",
        ], {
            cwd: root,
            env: {
                ...process.env,
                SPLITSHOT_FORCE_FAIL_TASK_IDS: "t1",
            },
        });

        expect(out.status).not.toBe(0);

        const latest = JSON.parse(fs.readFileSync(path.join(work, ".codex-parallel", "runs", "latest.json"), "utf8"));
        const evs = readLines(path.join(latest.runDir, "events.ndjson")).map((l) => JSON.parse(l));
        const starts = evs.filter((e) => e.type === "state" && e.data?.phase === "start").map((e) => e.runId);
        expect(starts).toContain("t1");
        expect(starts).not.toContain("t2");

        const blocked = evs.find((e) => e.type === "state" && e.runId === "t2" && e.data?.phase === "blocked");
        expect(blocked?.data?.reason).toBe("dependency_failed");
        expect(blocked?.data?.deps).toContain("t1");
    });
});
