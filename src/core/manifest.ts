import fs from "node:fs";
import path from "node:path";
import { z, ZodError } from "zod";

export class ManifestValidationError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = "ManifestValidationError";
        if (cause && typeof cause === "object") {
            (this as { cause?: unknown }).cause = cause;
        }
        if (cause instanceof Error && cause.stack && !this.stack?.includes(cause.stack)) {
            this.stack += `\nCaused by: ${cause.stack}`;
        }
    }
}

const workerBranchSchema = z.object({
    id: z.string().min(1),
    branch: z.string().min(1),
    dir: z.string().min(1),
});

const manifestV3Schema = z.object({
    version: z.literal(3),
    createdAt: z.string().refine((value) => {
        const time = Date.parse(value);
        return Number.isFinite(time);
    }, { message: "createdAt must be an ISO date string" }),
    objective: z
        .object({
            sourcePath: z.string().min(1),
            outputFile: z.string().min(1),
        })
        .optional(),
    docs: z.object({
        spec: z.string(),
        interface: z.string(),
        todos: z.array(z.string()).min(1),
        index: z.string().optional(),
    }),
    worktrees: z.object({
        base: z.string(),
        branches: z.array(workerBranchSchema),
    }),
    prompts: z.object({
        sourceHome: z.string(),
        used: z.array(z.string().min(1)).default([]),
    }),
    run: z.object({
        maxParallel: z.number().int().positive(),
        codexHomes: z.object({}).catchall(z.string()),
        events: z.string(),
    }),
});

export type ManifestV3 = z.infer<typeof manifestV3Schema>;

function toPosix(p: string) {
    return p.replace(/\\+/g, "/");
}

function ensureSafeRelative(p: string, opts?: { allowParent?: boolean }): void {
    if (!p) {
        throw new ManifestValidationError("Unsafe path: value is empty");
    }
    if (path.isAbsolute(p)) {
        throw new ManifestValidationError(`Unsafe absolute path: ${p}`);
    }
    const segments = toPosix(p).split("/");
    if (!opts?.allowParent && segments.some((segment) => segment === "..")) {
        throw new ManifestValidationError(`Path contains unsafe segment '..': ${p}`);
    }
}

function enforcePathSafety(manifest: ManifestV3): ManifestV3 {
    const check = (value: string, location: string, allowParent = false) => {
        try {
            ensureSafeRelative(value, { allowParent });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new ManifestValidationError(`Manifest v3 unsafe path at ${location}: ${message}`, err);
        }
    };

    if (manifest.objective) {
        check(manifest.objective.sourcePath, "objective.sourcePath");
        check(manifest.objective.outputFile, "objective.outputFile");
    }
    check(manifest.docs.spec, "docs.spec");
    check(manifest.docs.interface, "docs.interface");
    manifest.docs.todos.forEach((value, idx) => check(value, `docs.todos[${idx}]`));
    if (manifest.docs.index) {
        check(manifest.docs.index, "docs.index");
    }
    check(manifest.worktrees.base, "worktrees.base", true);
    manifest.worktrees.branches.forEach((branch, idx) => {
        check(branch.dir, `worktrees.branches[${idx}].dir`, true);
    });
    check(manifest.prompts.sourceHome, "prompts.sourceHome");
    Object.entries(manifest.run.codexHomes).forEach(([workerId, value]) => {
        check(value, `run.codexHomes.${workerId}`);
    });
    check(manifest.run.events, "run.events");
    return manifest;
}

export function validateManifestV3(candidate: unknown): ManifestV3 {
    try {
        const parsed = manifestV3Schema.parse(candidate);
        return enforcePathSafety(parsed);
    } catch (err) {
        if (err instanceof ManifestValidationError) {
            throw err;
        }
        if (err instanceof ZodError) {
            const issues = (err as unknown as { issues?: z.ZodIssue[] }).issues ?? [];
            const first = issues[0];
            const pathStr = first?.path?.length ? first.path.join(".") : "<root>";
            const baseMessage = first?.message ?? err.message;
            throw new ManifestValidationError(
                `Manifest v3 validation failed at ${pathStr}: ${baseMessage}`,
                err
            );
        }
        throw new ManifestValidationError("Manifest v3 validation failed", err);
    }
}

export function readManifestV3(filePath: string): ManifestV3 {
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        return validateManifestV3(parsed);
    } catch (err) {
        if (err instanceof ManifestValidationError) {
            throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new ManifestValidationError(`Failed to read manifest at ${filePath}: ${message}`, err);
    }
}

export function writeManifestV3(filePath: string, manifest: ManifestV3): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const payload = JSON.stringify(validateManifestV3(manifest), null, 2);
    fs.writeFileSync(filePath, `${payload}\n`, "utf8");
}
