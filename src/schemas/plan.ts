// src/schemas/plan.ts
import fs from "node:fs";
import path from "node:path";
import { z, ZodError } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Plan } from "../core/types.js";

export const ProfileSchema = z.object({
    model: z.string().optional(),
    approval: z.enum(["suggest", "auto", "full-auto"]).optional(),
}).strict();

export const TaskSpecSchema = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    cwd: z.string(),
    prompt: z.string(),
    dependsOn: z.array(z.string()).optional(),
    acceptanceCriteria: z.string().optional(),
    artifactHints: z.array(z.string()).optional(),
    profile: ProfileSchema.optional(),
}).strict();

const WorkerIdPattern = /^w\d{2}$/;

export const GeneratedFileSchema = z.object({
    path: z.string(),
    description: z.string().optional(),
    role: z.enum(["worker-todo", "interface", "other"]).optional(),
    workerId: z
        .string()
        .regex(WorkerIdPattern, "workerId must be formatted as wNN")
        .optional(),
}).strict();

export const PlanSchema = z
    .object({
        meta: z
            .object({
                objective: z.string().optional(),
                workers: z.number().int().min(1).optional(),
            })
            .optional(),
        tasks: z.array(TaskSpecSchema).min(1),
        generatedFiles: z.array(GeneratedFileSchema).min(1),
    })
    .strict();

/** Zod → JSON Schema(2020-12) を生成してファイルへ書き出し */
export function writePlanJsonSchemaFile(destPath: string) {
    const jsonSchema = zodToJsonSchema(PlanSchema, { name: "ParallelPlan" });
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, JSON.stringify(jsonSchema, null, 2), "utf8");
}

/** 文字列JSONをZodで検証してPlan型として返す（ZodErrorは整形して投げ直し） */
export function parsePlanFromText(text: string): Plan {
    try {
        const data = JSON.parse(text);
        const parsed = PlanSchema.parse(data);
        return parsed as unknown as Plan;
    } catch (e) {
        if (e instanceof ZodError) {
            const msg = e.issues
                .map((i) => `${(i.path as (string | number)[]).join(".") || "/"} ${i.message}`)
                .join("; ");
            throw new Error(`Schema validation failed: ${msg}`);
        }
        throw e;
    }
}
