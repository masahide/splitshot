import { describe, it, expect } from "vitest";
import { parsePlanFromText } from "../src/schemas/plan.js";

const basePlan = {
    meta: { objective: "stub", workers: 2 },
    tasks: [
        {
            id: "t1",
            title: "bootstrap",
            summary: "init",
            cwd: ".",
            prompt: "do stub",
        },
    ],
    generatedFiles: [
        {
            path: "docs/worker-task/01/todo.md",
            description: "Worker TODO",
            role: "worker-todo" as const,
            workerId: "w01",
        },
    ],
};

function serialize(plan: unknown) {
    return JSON.stringify(plan);
}

function cloneBase() {
    return JSON.parse(serialize(basePlan));
}

describe("plan schema generatedFiles", () => {
    it("requires generatedFiles to be present", () => {
        const plan = cloneBase();
        delete (plan as Record<string, unknown>).generatedFiles;
        expect(() => parsePlanFromText(serialize(plan))).toThrowError(/generatedFiles/i);
    });

    it("rejects empty generatedFiles", () => {
        const plan = cloneBase();
        (plan as Record<string, unknown>).generatedFiles = [];
        expect(() => parsePlanFromText(serialize(plan))).toThrowError(/generatedFiles/i);
    });

    it("rejects entries without path", () => {
        const plan = cloneBase();
        (plan as Record<string, unknown>).generatedFiles = [
            { role: "worker-todo", workerId: "w01" },
        ];
        expect(() => parsePlanFromText(serialize(plan))).toThrowError(/path/i);
    });

    it("rejects entries with unknown keys", () => {
        const plan = cloneBase();
        (plan as Record<string, unknown>).generatedFiles = [
            {
                path: "docs/worker-task/01/todo.md",
                role: "worker-todo",
                workerId: "w01",
                extra: true,
            },
        ];
        expect(() => parsePlanFromText(serialize(plan))).toThrowError(/extra/i);
    });

    it("rejects invalid role values", () => {
        const plan = cloneBase();
        (plan as Record<string, unknown>).generatedFiles = [
            {
                path: "docs/interface.md",
                role: "invalid",
            },
        ];
        expect(() => parsePlanFromText(serialize(plan))).toThrowError(/role/i);
    });

    it("rejects invalid workerId format", () => {
        const plan = cloneBase();
        (plan as Record<string, unknown>).generatedFiles = [
            {
                path: "docs/worker-task/1/todo.md",
                role: "worker-todo",
                workerId: "worker-1",
            },
        ];
        expect(() => parsePlanFromText(serialize(plan))).toThrowError(/workerId/i);
    });

    it("accepts valid generatedFiles entries", () => {
        const plan = cloneBase();
        expect(() => parsePlanFromText(serialize(plan))).not.toThrow();
    });
});
