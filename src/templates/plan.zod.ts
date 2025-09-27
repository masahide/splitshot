// src/templates/plan.zod.ts
import { z } from "zod";

const ProfileZ = z.object({
    model: z.string().optional(),
    approval: z.enum(["suggest", "auto", "full-auto"]).optional(),
}).strict();

const TaskZ = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    cwd: z.string(),
    prompt: z.string(),
    dependsOn: z.array(z.string()).optional(),
    acceptanceCriteria: z.string().optional(),
    artifactHints: z.array(z.string()).optional(),
    profile: ProfileZ.optional(),
}).strict();

export const PlanZ = z.object({
    meta: z.object({
        objective: z.string().optional(),
        workers: z.number().int().min(1).optional(),
    }).catchall(z.unknown()).optional(), // additionalProperties: {} と同等
    tasks: z.array(TaskZ).min(1),
}).strict();

export type PlanFromZod = z.infer<typeof PlanZ>;
