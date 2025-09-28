export type GeneratedFile = {
    path: string;
    description?: string;
    role?: "worker-todo" | "interface" | "other";
    workerId?: string;
};

export type Plan = {
    meta?: { objective?: string; workers?: number };
    tasks: TaskSpec[];
    generatedFiles: GeneratedFile[];
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

export type Assignment = {
    taskId: string;
    worktreeDir: string;
    codexHome: string;
    profile?: { model?: string; approval?: "suggest" | "auto" | "full-auto" };
};

