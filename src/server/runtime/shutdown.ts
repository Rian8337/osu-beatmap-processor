export interface ShutdownOptions {
    /**
     * Everything to release. Pass the `AsyncDisposableStack` the resources were registered on: it disposes them
     * in reverse order, and keeps going when one fails.
     */
    readonly resources: AsyncDisposable;

    /**
     * Force-exit after this long. Defaults to 10 seconds.
     */
    readonly timeoutMs?: number;
    readonly exit?: (code: number) => void;
}

/**
 * Creates a signal handler that releases the resources and exits: 0 if everything was released, 1 if anything
 * failed or it took longer than the timeout.
 */
export function createShutdownHandler(
    options: ShutdownOptions,
): (signal: string) => void {
    const {
        resources,
        timeoutMs = 10_000,
        exit = (code: number) => process.exit(code),
    } = options;
    let shuttingDown = false;

    return (signal) => {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;
        console.log(`Received ${signal}; shutting down`);

        setTimeout(() => {
            console.error(
                `Shutdown did not finish within ${timeoutMs.toString()} ms; exiting`,
            );
            exit(1);
        }, timeoutMs).unref();

        resources[Symbol.asyncDispose]().then(
            () => {
                exit(0);
            },
            (e: unknown) => {
                console.error(
                    "Failed to release resources during shutdown:",
                    e,
                );
                exit(1);
            },
        );
    };
}
