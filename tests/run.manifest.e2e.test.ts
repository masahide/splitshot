import { describe, it, expect } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";

const cli = path.resolve("dist/cli/index.js");
const stub = path.resolve("tests/fixtures/codex-runner-stub.js");
const codexStub = path.resolve("tests/fixtures/codex-stub.js");

describe("run phase: manifest-driven parallel run", () => {
    it("runs workers from manifest and emits events.ndjson", async () => {
        // make a plan-dir first
        const planRes = await execa(process.execPath, [
            cli, "plan",
            "--objective", "Hello",
            "--workers", "2",
            "--codex-bin", codexStub
        ]);
        const { planDir } = JSON.parse(planRes.stdout);
        const { exitCode } = await execa(process.execPath, [
            cli, "run",
            "--plan-dir", planDir,
            "--codex-bin", stub,
            "--max-parallel", "2"
        ]);
        expect(exitCode).toBe(0);
        const latest = JSON.parse(fs.readFileSync(path.join(planDir, ".runs", "latest.json"), "utf8"));
        const evFile = path.join(latest.runDir, "events.ndjson");
        const text = fs.readFileSync(evFile, "utf8").trim();
        expect(text).toMatch(/"type":"state".*"phase":"start"/s);
        expect(text).toMatch(/"type":"state".*"phase":"exit"/s);
    });
});