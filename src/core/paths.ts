import fs from "node:fs";
import path from "node:path";

export function ensureDir(p: string) {
    fs.mkdirSync(p, { recursive: true });
}

export function writeFileUtf8(p: string, text: string) {
    ensureDir(path.dirname(p));
    fs.writeFileSync(p, text, "utf8");
}

export function createPlanDir(base: string) {
    const ts = Date.now();
    const dir = path.join(base, `plan-${ts}`);
    ensureDir(dir);
    return dir;
}

export function findLatestPlanDir(base: string): string | null {
    if (!fs.existsSync(base)) return null;
    const names = fs
        .readdirSync(base)
        .filter((n) => n.startsWith("plan-"))
        .map((n) => ({ n, t: Number(n.slice("plan-".length)) }))
        .filter((x) => !Number.isNaN(x.t))
        .sort((a, b) => b.t - a.t);
    if (names.length === 0) return null;
    return path.join(base, names[0].n);
}

export function isSafeRelativeUnder(base: string, rel: string): boolean {
    if (!rel || rel.trim() === "") return false;
    if (path.isAbsolute(rel)) return false;
    const normalizedBase = path.resolve(base);
    const target = path.resolve(normalizedBase, rel);
    const relative = path.relative(normalizedBase, target);
    if (!relative) return true;
    return !relative.startsWith("..") && !path.isAbsolute(relative);
}
