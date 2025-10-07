import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mkTmpWork } from "./helpers/tmp";
import { readManifestV3, validateManifestV3, writeManifestV3 } from "../src/core/manifest";

const baseManifest = {
    version: 3 as const,
    createdAt: "2025-01-01T00:00:00.000Z",
    objective: { sourcePath: "docs/spec.objective.md", outputFile: "docs/spec.md" },
    docs: {
        spec: "docs/spec.md",
        interface: "docs/interface.md",
        todos: ["docs/todo/agent-a.md", "docs/todo/agent-b.md"],
        index: "docs/docs.index.json",
    },
    worktrees: {
        base: "worktrees",
        branches: [
            { id: "w01", branch: "feature/agent-01", dir: "worktrees/agent-01" },
            { id: "w02", branch: "feature/agent-02", dir: "worktrees/agent-02" },
        ],
    },
    prompts: {
        sourceHome: ".codex-home/prompts",
        used: ["spec.md", "split.md"],
    },
    run: {
        maxParallel: 2,
        codexHomes: { w01: ".splitshot/plan-202501/.homes/w01", w02: ".splitshot/plan-202501/.homes/w02" },
        events: ".splitshot/plan-202501/.runs/173000/events.ndjson",
    },
};

describe("manifest.v3", () => {
    it("validates and round-trips manifest v3", () => {
        const validated = validateManifestV3(baseManifest);
        expect(validated).toEqual(baseManifest);

        const tmp = mkTmpWork("manifest-v3-");
        try {
            const manifestPath = path.join(tmp.dir, "manifest.v3.json");
            writeManifestV3(manifestPath, validated);
            expect(fs.existsSync(manifestPath)).toBe(true);
            const loaded = readManifestV3(manifestPath);
            expect(loaded).toEqual(validated);
        } finally {
            tmp.cleanup();
        }
    });

    it("rejects unsafe paths containing .. or absolute segments", () => {
        const invalid = {
            ...baseManifest,
            docs: {
                ...baseManifest.docs,
                spec: "../docs/spec.md",
            },
        };
        expect(() => validateManifestV3(invalid)).toThrow(/unsafe/i);

        const invalidAbs = {
            ...baseManifest,
            prompts: {
                ...baseManifest.prompts,
                sourceHome: "/tmp/prompts",
            },
        };
        expect(() => validateManifestV3(invalidAbs)).toThrow(/unsafe/i);
    });

    it("requires mandatory sections", () => {
        const missingRun: Record<string, unknown> = { ...baseManifest };
        delete missingRun.run;
        expect(() => validateManifestV3(missingRun)).toThrow(/run/i);
    });
});
