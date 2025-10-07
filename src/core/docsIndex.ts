import fs from "node:fs";
import path from "node:path";

export interface DocsIndexEntry {
    path: string;
    generatedBy: string;
    updatedAt: string;
}

export interface DocsIndex {
    documents: DocsIndexEntry[];
}

const EMPTY_INDEX: DocsIndex = { documents: [] };

export function readDocsIndex(filePath: string): DocsIndex {
    if (!fs.existsSync(filePath)) {
        return { documents: [] };
    }
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as Partial<DocsIndex>;
        if (!parsed || !Array.isArray(parsed.documents)) {
            return { documents: [] };
        }
        return { documents: parsed.documents.filter((entry): entry is DocsIndexEntry => Boolean(entry?.path)) };
    } catch {
        return { ...EMPTY_INDEX };
    }
}

function ensureDirOf(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function writeDocsIndex(filePath: string, index: DocsIndex): void {
    ensureDirOf(filePath);
    fs.writeFileSync(filePath, JSON.stringify(index, null, 2) + "\n", "utf8");
}

export function upsertDocsIndex(filePath: string, entry: { path: string; generatedBy: string; updatedAt?: string }): DocsIndex {
    const current = readDocsIndex(filePath);
    const normalizedPath = entry.path;
    const updatedAt = entry.updatedAt ?? new Date().toISOString();
    const existing = current.documents.find((doc) => doc.path === normalizedPath);
    if (existing) {
        existing.generatedBy = entry.generatedBy;
        existing.updatedAt = updatedAt;
    } else {
        current.documents.push({ path: normalizedPath, generatedBy: entry.generatedBy, updatedAt });
    }
    writeDocsIndex(filePath, current);
    return current;
}
