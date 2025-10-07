import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkTmpWork } from "./helpers/tmp";
import { installPromptSet, renderPrompt, resolveCodexHome } from "../src/core/codexPrompts";

const PROMPTS = ["agent-ja.md", "if-check.md", "spec.md", "split.md"];

let originalCodexHome: string | undefined;

beforeEach(() => {
    originalCodexHome = process.env.CODEX_HOME;
});

afterEach(() => {
    if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
    } else {
        process.env.CODEX_HOME = originalCodexHome;
    }
});

describe("codex prompts", () => {
    it("installs default prompt set under $CODEX_HOME/prompts", () => {
        const tmp = mkTmpWork("codex-home-");
        try {
            installPromptSet(tmp.dir);
            const promptsDir = path.join(tmp.dir, "prompts");
            expect(fs.existsSync(promptsDir)).toBe(true);
            const files = fs.readdirSync(promptsDir).sort();
            expect(files).toEqual(PROMPTS);
            const spec = fs.readFileSync(path.join(promptsDir, "spec.md"), "utf8");
            expect(spec).toContain("SplitShot");
        } finally {
            tmp.cleanup();
        }
    });

    it("renders prompt arguments with $1..$9, $ARGUMENTS, and $$", () => {
        const template = "First:$1 Second:$2 Rest:$ARGUMENTS Dollar:$$";
        const rendered = renderPrompt(template, ["alpha", "beta", "gamma"]);
        expect(rendered).toBe("First:alpha Second:beta Rest:alpha beta gamma Dollar:$");
    });

    it("resolves Codex home with priority cli option > env > default", () => {
        const envHome = path.join(os.tmpdir(), "env-codex");
        process.env.CODEX_HOME = envHome;
        const explicit = resolveCodexHome({ home: "./custom" });
        expect(explicit).toBe(path.resolve("./custom"));
        const fromEnv = resolveCodexHome();
        expect(fromEnv).toBe(envHome);
        delete process.env.CODEX_HOME;
        const fallback = resolveCodexHome();
        expect(fallback).toBe(path.join(os.homedir(), ".codex"));
    });
});
