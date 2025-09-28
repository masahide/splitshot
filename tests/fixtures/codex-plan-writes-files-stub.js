#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

const HELP = `Usage: codex exec [options] -- <prompt>
Options:
  --output-schema <file>
  --output-last-message <file>
  --json
  --cd <dir>
  --sandbox <mode>
  --skip-git-repo-check
  --color <mode>
`;

function printHelp() {
    // Node子プロセスのstdoutがサンドボックスで拾えないケースに備えてstderrにも流す
    process.stdout.write(HELP);
    process.stderr.write(HELP);
    process.exit(0);
}

if (args.includes("--help") || (args[0] === "help" && args[1] === "exec")) {
    printHelp();
}

if (args[0] !== "exec") {
    console.error(`Unknown invocation: ${args.join(" ")}`);
    process.exit(1);
}

function parseExec(argv) {
    const conf = {
        outputSchema: undefined,
        outputLastMessage: undefined,
        cd: process.cwd(),
        prompt: "",
    };
    let i = 0;
    while (i < argv.length) {
        const token = argv[i];
        const nextValue = () => {
            const v = argv[i + 1];
            if (v === undefined) {
                throw new Error(`Missing value for ${token}`);
            }
            i += 2;
            return v;
        };
        if (token === "--") {
            conf.prompt = argv.slice(i + 1).join(" ");
            break;
        }
        switch (token) {
            case "--output-schema":
                conf.outputSchema = path.resolve(nextValue());
                continue;
            case "--output-last-message":
                conf.outputLastMessage = path.resolve(nextValue());
                continue;
            case "--cd":
                conf.cd = path.resolve(nextValue());
                continue;
            case "--sandbox":
                nextValue();
                continue;
            case "--color":
                nextValue();
                continue;
            case "--skip-git-repo-check":
                i += 1;
                continue;
            case "--json":
                i += 1;
                continue;
            default:
                i += 1;
                continue;
        }
    }
    return conf;
}

async function main() {
    let conf;
    try {
        conf = parseExec(args.slice(1));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(msg);
        process.exit(1);
        return;
    }

    const planDirMatch = /-(\s*.*?)\/docs\//.exec(conf.prompt);
    const planDir = planDirMatch ? planDirMatch[1].trim() : conf.cd ?? process.cwd();
    fs.mkdirSync(planDir, { recursive: true });

    const docsDir = path.join(planDir, "docs");
    const workerTaskDir = path.join(docsDir, "worker-task");

    const workerMatch = /-\s*workers:\s*(\d+)/.exec(conf.prompt);
    const workerCount = workerMatch ? Math.max(1, parseInt(workerMatch[1], 10) || 1) : 2;

    const generatedFiles = [];

    for (let i = 0; i < workerCount; i++) {
        const id = String(i + 1).padStart(2, "0");
        const dir = path.join(workerTaskDir, id);
        fs.mkdirSync(dir, { recursive: true });
        const todoPath = path.join(dir, "todo.md");
        const body = `# Worker ${id} TODO\n\n- これはスタブが生成したサンプル TODO です。\n`;
        fs.writeFileSync(todoPath, body, "utf8");
        generatedFiles.push({
            path: path.join("docs", "worker-task", id, "todo.md"),
            description: `Worker ${id} TODO from stub`,
            role: "worker-todo",
            workerId: `w${id}`,
        });
    }

    fs.mkdirSync(docsDir, { recursive: true });
    const interfacePath = path.join(docsDir, "interface.md");
    const interfaceBody = `# Interface Spec\n\nこのファイルはスタブによって生成されました。\n`;
    fs.writeFileSync(interfacePath, interfaceBody, "utf8");
    generatedFiles.push({
        path: path.join("docs", "interface.md"),
        description: "Integration interface stub",
        role: "interface",
    });

    if (process.env.PLAN_STUB_COLLIDE_DOCS === "1") {
        // conf.cd は --cd で渡された planDir
        const planAbs = path.resolve(planDir);
        const docsAbs = path.resolve(docsDir);
        const underPlan = docsAbs.startsWith(planAbs + path.sep);
        if (underPlan) {
            fs.chmodSync(docsDir, 0o400);
        } else {
            // もし plan-dir 配下でなければ、何もしない（誤爆防止）
            process.stderr.write(
                `[stub:guard] skip chmod: docsDir=${docsAbs} not under plan=${planAbs}\n`
            );
        }
    }

    const unsafePath = process.env.PLAN_STUB_UNSAFE_PATH;
    if (unsafePath && typeof unsafePath === "string") {
        generatedFiles.push({
            path: unsafePath,
            description: "Injected unsafe path for tests",
            role: "other",
        });
    }

    const dropGeneratedFiles = process.env.PLAN_STUB_DROP_GENERATED_FILES === "1";

    const plan = {
        meta: { objective: "stub-objective", workers: workerCount },
        tasks: [
            {
                id: "t1",
                title: "bootstrap",
                summary: "initialize plan",
                cwd: ".",
                prompt: "do something",
            },
        ],
        generatedFiles: dropGeneratedFiles ? [] : generatedFiles,
    };

    const jsonText = JSON.stringify(plan, null, 2);
    const fallbackPlanPath = path.join(planDir, "plan.stub.json");
    try {
        fs.writeFileSync(fallbackPlanPath, jsonText, "utf8");
    } catch (err) {
        // ignore fallback write failure; this is best-effort to help tests
        void err;
    }
    if (conf.outputLastMessage) {
        fs.mkdirSync(path.dirname(conf.outputLastMessage), { recursive: true });
        fs.writeFileSync(conf.outputLastMessage, jsonText, "utf8");
    } else {
        console.log(jsonText);
    }
}

await main();
