export type TodoPhase = "scope" | "test" | "implement" | "refactor" | "checks" | "other";

export interface TodoDocument {
    title: string;
    scope: string[];
    test: string[];
    implement: string[];
    refactor: string[];
    checks: string[];
    other: string[];
}

function normalizeHeading(raw: string): TodoPhase {
    const lower = raw.toLowerCase();
    if (lower.includes("範囲") || lower.includes("scope")) {
        return "scope";
    }
    if (lower.includes("機械") || lower.includes("check")) {
        return "checks";
    }
    if (lower.includes("リファク") || lower.includes("refactor") || lower.includes("refine")) {
        return "refactor";
    }
    if (lower.includes("実装") || lower.includes("implement") || lower.includes("code")) {
        return "implement";
    }
    if (lower.includes("テスト") || lower.includes("test")) {
        return "test";
    }
    return "other";
}

function extractListItem(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
        const content = bullet[1].trim();
        return content.replace(/^\[[ xX]\]\s*/, "").trim();
    }
    const ordered = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ordered) {
        return ordered[1].trim();
    }
    return null;
}

export function parseTodoMarkdown(markdown: string): TodoDocument {
    const lines = markdown.split(/\r?\n/);
    const doc: TodoDocument = {
        title: "",
        scope: [],
        test: [],
        implement: [],
        refactor: [],
        checks: [],
        other: [],
    };

    let phase: TodoPhase = "other";
    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!doc.title) {
            const titleMatch = /^#\s+(.+)$/.exec(line);
            if (titleMatch) {
                doc.title = titleMatch[1].trim();
                continue;
            }
        }
        const headingMatch = /^#{2,}\s+(.+)$/.exec(line);
        if (headingMatch) {
            phase = normalizeHeading(headingMatch[1]);
            continue;
        }
        const item = extractListItem(line);
        if (!item) continue;
        switch (phase) {
            case "scope":
                doc.scope.push(item);
                break;
            case "test":
                doc.test.push(item);
                break;
            case "implement":
                doc.implement.push(item);
                break;
            case "refactor":
                doc.refactor.push(item);
                break;
            case "checks":
                doc.checks.push(item);
                break;
            default:
                doc.other.push(item);
                break;
        }
    }

    return doc;
}
