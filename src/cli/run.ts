import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { ensureDir, findLatestPlanDir, writeFileUtf8 } from "../core/paths.js";
import { inheritCodexAuthFiles } from "../core/codexAuth.js";
import { createEventsWriter } from "../core/eventsWriter.js";
import { JsonlFollower } from "../core/jsonlFollower.js";
import { readManifestV3, writeManifestV3, type ManifestV3 } from "../core/manifest.js";
import { createWorktrees } from "../core/worktrees.js";

interface RunOptions {
    planDir?: string;
    codexBin: string;
    maxParallel?: number;
    jsonlInterval?: number;
    createWorktrees?: boolean;
    worktreeBase?: string;
    branchPrefix?: string;
    startPoint?: string;
    gitBin: string;
}

interface WorkerSpec {
    id: string;
    checklistRel: string;
    checklistAbs: string;
    codexHomeRel: string;
    codexHomeAbs: string;
}

function toPosix(value: string): string {
    return value.replace(/\\+/g, "/");
}

function resolvePlanDir(planDirOption: string | undefined): string {
    if (planDirOption) {
        const abs = path.resolve(planDirOption);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
            throw new Error(`plan-dir が見つかりません: ${planDirOption}`);
        }
        return abs;
    }
    const base = path.resolve(".splitshot");
    const latest = findLatestPlanDir(base);
    if (!latest) {
        throw new Error("最新の plan-dir が見つかりません。Step3 を先に実行してください。");
    }
    return latest;
}

function gatherWorkers(planDir: string, manifest: ManifestV3): WorkerSpec[] {
    const ids = Object.keys(manifest.run.codexHomes).sort();
    if (ids.length === 0) {
        throw new Error("manifest.run.codexHomes に対象ワーカーが定義されていません");
    }
    return ids.map((workerId) => {
        const codexHomeRel = manifest.run.codexHomes[workerId];
        const codexHomeAbs = path.resolve(planDir, codexHomeRel);
        const suffix = workerId.replace(/^w/, "");
        const checklistRel = toPosix(path.join("checklists", `worker-${suffix}.md`));
        const checklistAbs = path.join(planDir, checklistRel);
        if (!fs.existsSync(checklistAbs)) {
            throw new Error(`チェックリストが見つかりません: ${checklistRel}`);
        }
        return { id: workerId, checklistRel, checklistAbs, codexHomeRel, codexHomeAbs };
    });
}

async function ensureWorktrees(opts: {
    repoDir: string;
    planDir: string;
    manifest: ManifestV3;
    count: number;
    baseRelative: string;
    branchPrefix: string;
    startPoint: string;
    gitBin: string;
}): Promise<ManifestV3> {
    return createWorktrees({
        repoDir: opts.repoDir,
        planDir: opts.planDir,
        manifest: opts.manifest,
        count: opts.count,
        baseRelative: opts.baseRelative,
        branchPrefix: opts.branchPrefix,
        startPoint: opts.startPoint,
        gitBin: opts.gitBin,
        env: process.env,
    });
}

function parseJsonlInterval(raw?: string): number {
    if (!raw) return 200;
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`jsonl-interval は正の整数で指定してください: ${raw}`);
    }
    return value;
}

export function cmdRun(): Command {
    const cmd = new Command("run");
    cmd
        .description("manifest.v3.json を読み取り、チェックリストを codex exec へ投入する")
        .option("--plan-dir <dir>", "実行対象の plan-dir")
        .option("--codex-bin <path>", "Codex 実行バイナリ", process.env.FAKE_CODEX_BIN ?? "codex")
        .option("--max-parallel <n>", "最大並列数 (既定: manifest.run.maxParallel)", (value) => parseInt(value, 10))
        .option("--jsonl-interval <ms>", "events 追跡のポーリング間隔 (ms)")
        .option("--create-worktrees", "実行前に worktrees up を走らせる")
        .option("--worktree-base <dir>", "worktree を作成する相対ディレクトリ")
        .option("--branch-prefix <name>", "branch 名のプレフィックス", "feature/agent-")
        .option("--start-point <ref>", "worktree 作成元の Git リファレンス", "main")
        .option("--git-bin <path>", "git 実行バイナリ", process.env.FAKE_GIT_BIN ?? "git")
        .action(async (rawOpts) => {
            const opts: RunOptions = {
                planDir: rawOpts.planDir,
                codexBin: rawOpts.codexBin,
                maxParallel: typeof rawOpts.maxParallel === "number" ? rawOpts.maxParallel : undefined,
                jsonlInterval: parseJsonlInterval(rawOpts.jsonlInterval),
                createWorktrees: Boolean(rawOpts.createWorktrees),
                worktreeBase: rawOpts.worktreeBase,
                branchPrefix: rawOpts.branchPrefix,
                startPoint: rawOpts.startPoint,
                gitBin: rawOpts.gitBin,
            };

            const repoDir = process.cwd();
            const planDir = resolvePlanDir(opts.planDir);
            const manifestPath = path.join(planDir, "manifest.v3.json");
            let manifest = readManifestV3(manifestPath);

            const workers = gatherWorkers(planDir, manifest);

            if (opts.createWorktrees) {
                const baseRelative = opts.worktreeBase ?? manifest.worktrees.base;
                manifest = await ensureWorktrees({
                    repoDir,
                    planDir,
                    manifest,
                    count: workers.length,
                    baseRelative,
                    branchPrefix: opts.branchPrefix ?? "feature/agent-",
                    startPoint: opts.startPoint ?? "main",
                    gitBin: opts.gitBin,
                });
                writeManifestV3(manifestPath, manifest);
            }

            const runBase = path.join(planDir, ".runs");
            ensureDir(runBase);
            const runName = String(Date.now());
            const runDir = path.join(runBase, runName);
            ensureDir(runDir);
            const eventsPath = path.join(runDir, "events.ndjson");
            const events = createEventsWriter(eventsPath);

            const maxParallel = opts.maxParallel && opts.maxParallel > 0 ? opts.maxParallel : manifest.run.maxParallel;
            if (!maxParallel || maxParallel <= 0) {
                throw new Error("並列数が決定できませんでした。--max-parallel または manifest.run.maxParallel を確認してください。");
            }

            const jsonlInterval = opts.jsonlInterval ?? 200;

            const jobs = workers.map((worker) => async () => {
                ensureDir(worker.codexHomeAbs);
                inheritCodexAuthFiles(worker.codexHomeAbs);

                const follower = new JsonlFollower(
                    path.join(worker.codexHomeAbs, "sessions"),
                    (line) => events.write({ t: Date.now(), type: "jsonl", runId: worker.id, data: { line } }),
                    jsonlInterval
                );
                follower.start();

                events.write({ t: Date.now(), type: "state", runId: worker.id, data: { phase: "start" } });

                const prompt = fs.readFileSync(worker.checklistAbs, "utf8");
                const execArgs = ["exec", "--", prompt];
                const child = spawn(
                    opts.codexBin.endsWith(".js") ? process.execPath : opts.codexBin,
                    opts.codexBin.endsWith(".js") ? [opts.codexBin, ...execArgs] : execArgs,
                    {
                        cwd: repoDir,
                        env: {
                            ...process.env,
                            CODEX_HOME: worker.codexHomeAbs,
                            SPLITSHOT_RUN_ID: worker.id,
                            SPLITSHOT_CHECKLIST_FILE: worker.checklistAbs,
                        },
                        stdio: ["ignore", "pipe", "pipe"],
                        windowsHide: true,
                    }
                );

                const rl = (stream: NodeJS.ReadableStream) =>
                    readline.createInterface({ input: stream, crlfDelay: Infinity });
                rl(child.stdout!).on("line", (line) =>
                    events.write({ t: Date.now(), type: "stdout", runId: worker.id, data: { line } })
                );
                rl(child.stderr!).on("line", (line) =>
                    events.write({ t: Date.now(), type: "stderr", runId: worker.id, data: { line } })
                );

                const exitCode: number = await new Promise((resolve) => {
                    child.on("close", (code) => resolve(code ?? 1));
                });

                await new Promise((resolve) => setTimeout(resolve, jsonlInterval));
                follower.stop();

                events.write({
                    t: Date.now(),
                    type: "state",
                    runId: worker.id,
                    data: { phase: "exit", code: exitCode },
                });
                return exitCode;
            });

            let anyFailed = false;
            await runWithLimit(maxParallel, jobs, (code) => {
                if (code !== 0) anyFailed = true;
            });
            await events.close();

            writeFileUtf8(
                path.join(runBase, "latest.json"),
                JSON.stringify({ runDir }, null, 2)
            );

            writeManifestV3(
                manifestPath,
                {
                    ...manifest,
                    run: {
                        ...manifest.run,
                        maxParallel,
                        codexHomes: workers.reduce<Record<string, string>>((acc, worker) => {
                            acc[worker.id] = toPosix(path.relative(planDir, worker.codexHomeAbs));
                            return acc;
                        }, {}),
                        events: toPosix(path.relative(planDir, eventsPath)),
                    },
                }
            );

            process.exit(anyFailed ? 1 : 0);
        });

    return cmd;
}

async function runWithLimit(
    limit: number,
    jobs: Array<() => Promise<number>>,
    onFinish: (code: number) => void
) {
    let index = 0;
    let active = 0;

    return new Promise<void>((resolve) => {
        const launchNext = () => {
            if (index === jobs.length && active === 0) {
                resolve();
                return;
            }
            while (active < limit && index < jobs.length) {
                const job = jobs[index++];
                active += 1;
                job()
                    .then((code) => onFinish(code))
                    .catch(() => onFinish(1))
                    .finally(() => {
                        active -= 1;
                        launchNext();
                    });
            }
        };
        launchNext();
    });
}
