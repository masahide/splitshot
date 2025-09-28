export type PlannerObjective = {
    /**
     * 相対パス（カレントワーキングディレクトリを起点）で表した目的ファイルのパス。
     * Codex はカレントワーキングディレクトリで実行されるため、このパスを
     * そのまま提示すれば内容を参照できる。
     */
    planRelativePath: string;
    /**
     * 元ファイルの絶対パス（参考情報）。Codex には通知のみで、実際の参照は plan-dir 配下のコピーを使う。
     */
    sourcePath?: string;
};

export type PlanInput = {
    objective: PlannerObjective;
    workers?: number;
    repo?: { root?: string; branch?: string; headSha?: string };
    planDir?: string;
};

export const PLANNER_DELIVERABLES_HINT = (
    p: Pick<PlanInput, "planDir"> & { planDir: string }
) => [    "DELIVERABLES:",
    `- ${p.planDir}/docs/ 配下に実ファイルを書き出し、その相対パス(${p.planDir}からの)を generatedFiles[] に列挙してください。`,
    `- 必須: ${p.planDir}/docs/worker-task/XX/todo.md (XX=01..N) と ${p.planDir}/docs/interface.md を Markdown (日本語) で作成してください。`,
    "- すべて相対パスのみを使用し、'..' を含めないこと。1ファイルあたりのサイズ目安は 50KB 程度です。",
].join("\n");

export function buildPlannerPrompt(p: PlanInput): string {
    const workers = p.workers ?? 3;
    return [
        "You are a senior planning agent. Output STRICT JSON ONLY, complying with the provided JSON Schema. No prose.",
        "",
        "OBJECTIVE FILE (relative to working directory):",
        p.objective.planRelativePath,
        ...(
            p.objective.sourcePath
                ? ["SOURCE FILE (absolute reference):", p.objective.sourcePath]
                : []
        ),
        "",
        "Before producing the plan, read the objective file to understand the request. Summaries or key notes should come from that file.",
        "",
        "CONSTRAINTS:",
        `- workers: ${workers}`,
        "",
        PLANNER_DELIVERABLES_HINT({ planDir: p.planDir ?? "." }),
        "",
        "REPO CONTEXT:",
        `${p.repo?.root ?? ""} / ${p.repo?.branch ?? ""} / ${p.repo?.headSha ?? ""}`,
    ].join("\n");
}
