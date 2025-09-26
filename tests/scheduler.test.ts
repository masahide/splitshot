import { describe, it, expect } from "vitest";
import { buildBatches } from "../src/core/scheduler.js";
import type { TaskSpec } from "../src/core/types";

describe("run scheduling with maxParallel (skeleton)", () => {
    it("builds batches in topo order", () => {
        const tasks: TaskSpec[] = [
            { id: "t1", title: "A", summary: "", cwd: ".", prompt: "" },
            { id: "t2", title: "B", summary: "", cwd: ".", prompt: "", dependsOn: ["t1"] },
            { id: "t3", title: "C", summary: "", cwd: ".", prompt: "", dependsOn: ["t1"] },
        ];
        const batches = buildBatches(tasks);
        // 期待: [ [t1], [t2,t3] ]
        expect(batches.length).toBe(2);
        expect(batches[0].map((t) => t.id)).toEqual(["t1"]);
        expect(new Set(batches[1].map((t) => t.id))).toEqual(new Set(["t2", "t3"]));
    });
});
