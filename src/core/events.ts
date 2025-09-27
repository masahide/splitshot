export type StateEventData =
    | { phase: "start" }
    | { phase: "exit"; code: number }
    | { phase: "blocked"; reason: string; deps?: string[] };

export type LineEventData = { line: string };

export type StateEvent = {
    t: number;
    type: "state";
    runId: string;
    data: StateEventData;
};

export type LineEvent = {
    t: number;
    type: "stdout" | "stderr" | "jsonl";
    runId: string;
    data: LineEventData;
};

export type EventRecord = StateEvent | LineEvent;

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}

export function isEventRecord(u: unknown): u is EventRecord {
    if (!isObject(u)) return false;
    const t = (u as Record<string, unknown>).type;
    const d = (u as Record<string, unknown>).data;
    const runId = (u as Record<string, unknown>).runId;
    const ts = (u as Record<string, unknown>).t;
    if (typeof ts !== "number" || typeof runId !== "string" || typeof t !== "string" || !isObject(d)) {
        return false;
    }
    if (t === "state") {
        const phase = (d as Record<string, unknown>).phase;
        if (phase === "start") return true;
        if (phase === "exit") return typeof (d as Record<string, unknown>).code === "number";
        if (phase === "blocked") return typeof (d as Record<string, unknown>).reason === "string";
        return false;
    }
    if (t === "stdout" || t === "stderr" || t === "jsonl") {
        return typeof (d as Record<string, unknown>).line === "string";
    }
    return false;
}

export function parseEventLine(line: string): EventRecord | null {
    try {
        const obj = JSON.parse(line) as unknown;
        return isEventRecord(obj) ? obj : null;
    } catch {
        return null;
    }
}