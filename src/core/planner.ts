export type PlanInput = {
    objective: string;
    workers?: number;
    repo?: { root?: string; branch?: string; headSha?: string };
};

export const PLANNER_DELIVERABLES_HINT = [
    "DELIVERABLES:",
    "- docs/ 配下に実ファイルを書き出し、その相対パスを generatedFiles[] に列挙してください (role/workerId も必要に応じて設定)。",
    "- 必須: docs/worker-task/XX/todo.md (XX=01..N) と docs/interface.md を Markdown (日本語) で作成してください。",
    "- すべて相対パスのみを使用し、'..' を含めないこと。1ファイルあたりのサイズ目安は 50KB 程度です。",
].join("\n");

export function buildPlannerPrompt(p: PlanInput): string {
    const workers = p.workers ?? 3;
    return [
        "You are a senior planning agent. Output STRICT JSON ONLY, complying with the provided JSON Schema. No prose.",
        "",
        "OBJECTIVE:",
        p.objective.trim(),
        "",
        "CONSTRAINTS:",
        `- workers: ${workers}`,
        "",
        PLANNER_DELIVERABLES_HINT,
        "",
        "REPO CONTEXT:",
        `${p.repo?.root ?? ""} / ${p.repo?.branch ?? ""} / ${p.repo?.headSha ?? ""}`,
    ].join("\n");
}
