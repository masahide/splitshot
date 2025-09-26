import { describe, it, expect } from "vitest";
import { buildBatches } from "../src/core/scheduler";
import type { TaskSpec } from "../src/core/types";

describe("scheduler.buildBatches", () => {
    it("topologically groups tasks into batches", () => {
        const tasks: TaskSpec[] = [
            { id: "t1", title: "A", summary: "", cwd: ".", prompt: "" },
            { id: "t2", title: "B", summary: "", cwd: ".", prompt: "", dependsOn: ["t1"] },
            { id: "t3", title: "C", summary: "", cwd: ".", prompt: "", dependsOn: ["t1"] },
            { id: "t4", title: "D", summary: "", cwd: ".", prompt: "", dependsOn: ["t2", "t3"] }
        ];

        const layers = buildBatches(tasks);
        // 期待: [ [t1], [t2,t3], [t4] ]
        expect(layers.length).toBe(3);
        expect(layers[0].map(t => t.id)).toEqual(["t1"]);
        expect(new Set(layers[1].map(t => t.id))).toEqual(new Set(["t2", "t3"]));
        expect(layers[2].map(t => t.id)).toEqual(["t4"]);
    });

    it("throws on cycles", () => {
        const tasks: TaskSpec[] = [
            { id: "a", title: "", summary: "", cwd: ".", prompt: "", dependsOn: ["b"] },
            { id: "b", title: "", summary: "", cwd: ".", prompt: "", dependsOn: ["a"] }
        ];
        expect(() => buildBatches(tasks)).toThrow();
    });
});
