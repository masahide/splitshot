export type PlanInput = {
    objective: string;
    workers?: number;
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
        "",
        "REPO CONTEXT:",
        `${p.repo?.root ?? ""} / ${p.repo?.branch ?? ""} / ${p.repo?.headSha ?? ""}`,
    ].join("\n");
}
