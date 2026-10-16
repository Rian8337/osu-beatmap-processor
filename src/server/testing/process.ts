import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * A running Node process started by {@link startProcess}. Disposing kills it if it is still running.
 */
export interface StartedProcess extends AsyncDisposable {
    readonly child: ChildProcess;

    /**
     * Resolves with the exit code when the process exits.
     */
    readonly exited: Promise<number | null>;

    /**
     * Everything the process has written to stdout and stderr so far.
     */
    output(): string;
}

/**
 * Starts `node <script>` and resolves once `GET readyUrl` answers with a 2xx status (or, if `isReady` is given,
 * once it returns true for the response, for servers whose cheapest route answers an error such as 401).
 *
 * @throws {Error} With the process output, if the process exits or `timeoutMs` passes before it is ready.
 */
export async function startProcess(options: {
    script: string;
    env: NodeJS.ProcessEnv;
    readyUrl: string;
    timeoutMs?: number;
    isReady?: (response: Response) => boolean;
}): Promise<StartedProcess> {
    const {
        script,
        env,
        readyUrl,
        timeoutMs = 20_000,
        isReady = (response: Response) => response.ok,
    } = options;
    const child = spawn("node", [script], { env });
    let output = "";

    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));

    const exited = new Promise<number | null>((resolve) =>
        child.once("exit", (code) => resolve(code)),
    );

    const started: StartedProcess = {
        child,
        exited,
        output: () => output,
        [Symbol.asyncDispose]: async () => {
            if (child.exitCode === null && child.signalCode === null) {
                child.kill("SIGKILL");
                await exited;
            }
        },
    };

    const deadline = Date.now() + timeoutMs;

    while (child.exitCode === null && child.signalCode === null) {
        const ready = await fetch(readyUrl)
            .then(isReady)
            .catch(() => false);

        if (ready) {
            return started;
        }

        if (Date.now() > deadline) {
            await started[Symbol.asyncDispose]();

            throw new Error(
                `${script} was not ready within ${timeoutMs.toString()} ms:\n${output}`,
            );
        }

        await sleep(200);
    }

    // Let the exit finish so the stream handlers have collected the last output.
    await exited;

    throw new Error(`${script} exited before it was ready:\n${output}`);
}
