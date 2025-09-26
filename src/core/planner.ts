export type PlanInput = {
    objective: string;
    workers?: number;
    avoidPaths?: string[];
    mustPaths?: string[];
    approval?: "suggest" | "auto" | "full-auto";
    model?: string;
    deadline?: string;
    repo?: { root?: string; branch?: string; headSha?: string };
};

export function buildPlannerPrompt(p: PlanInput): string {
    return [
        "You are a senior planning agent. Output STRICT JSON ONLY, complying with the provided JSON Schema. No prose.",
        "",
        "OBJECTIVE:",
        p.objective.trim(),
        "",
        "CONSTRAINTS:",
        `- workers: ${p.workers ?? 3}`,
        `- avoid: ${p.avoidPaths?.join(", ") || "none"}`,
        `- mustTouch: ${p.mustPaths?.join(", ") || "none"}`,
        `- approval: ${p.approval ?? "suggest"}`,
        `- model: ${p.model ?? "default"}`,
        `- deadline: ${p.deadline ?? "n/a"}`,
        "",
        "REPO CONTEXT:",
        `${p.repo?.root ?? ""} / ${p.repo?.branch ?? ""} / ${p.repo?.headSha ?? ""}`,
    ].join("\n");
}
