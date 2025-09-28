import { describe, it, expect } from "vitest";
import { buildPlannerPrompt } from "../src/core/planner.js";

describe("buildPlannerPrompt deliverables guidance", () => {
    it("mentions generated files requirements", () => {
        const prompt = buildPlannerPrompt({ objective: "Sample", workers: 3 });
        expect(prompt).toContain("generatedFiles");
        expect(prompt).toMatch(/docs\//);
        expect(prompt).toMatch(/docs\/worker-task\/XX\/todo\.md/);
        expect(prompt).toMatch(/docs\/interface\.md/);
        expect(prompt).toMatch(/相対パス/);
        expect(prompt).toMatch(/\.\./);
        expect(prompt).toMatch(/50KB/);
    });
});
