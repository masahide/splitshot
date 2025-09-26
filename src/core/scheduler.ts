import type { TaskSpec } from "./types";

/**
 * 依存関係に基づき、同時実行できるタスク群（バッチ）に分割する。
 * トポロジカル順序。循環があれば例外。
 */
export function buildBatches(tasks: TaskSpec[]): TaskSpec[][] {
    const byId = new Map<string, TaskSpec>(tasks.map(t => [t.id, t]));
    const indeg = new Map<string, number>();
    const adj = new Map<string, Set<string>>();

    // 初期化
    for (const t of tasks) {
        indeg.set(t.id, 0);
        adj.set(t.id, new Set());
    }
    for (const t of tasks) {
        for (const d of t.dependsOn ?? []) {
            if (!byId.has(d)) throw new Error(`dependsOn not found: ${t.id} -> ${d}`);
            indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
            adj.get(d)!.add(t.id);
        }
    }

    const layers: TaskSpec[][] = [];
    let ready = tasks.filter(t => (indeg.get(t.id) ?? 0) === 0);

    let visited = 0;
    while (ready.length > 0) {
        layers.push(ready);
        const next: TaskSpec[] = [];
        for (const u of ready) {
            visited++;
            for (const v of adj.get(u.id) ?? []) {
                const deg = (indeg.get(v) ?? 0) - 1;
                indeg.set(v, deg);
                if (deg === 0) next.push(byId.get(v)!);
            }
        }
        ready = next;
    }

    if (visited !== tasks.length) {
        throw new Error("cycle detected in dependsOn");
    }
    return layers;
}
