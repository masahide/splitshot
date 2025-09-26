export type Plan = {
    meta?: { objective?: string; workers?: number };
    tasks: TaskSpec[];
};

export type TaskSpec = {
    id: string;
    title: string;
    summary: string;
    cwd: string;
    prompt: string;
    dependsOn?: string[];
    acceptanceCriteria?: string;
    artifactHints?: string[];
    profile?: { model?: string; approval?: "suggest" | "auto" | "full-auto" };
};
