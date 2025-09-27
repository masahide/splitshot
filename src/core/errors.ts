export function formatCliError(cmd: string, reason: string, hint?: string) {
    return [
        `[splitshot ${cmd}]`,
        reason.trim(),
        hint ? `Hint: ${hint.trim()}` : ""
    ].filter(Boolean).join(" ");
}