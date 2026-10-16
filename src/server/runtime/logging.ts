const methods = ["log", "info", "warn", "error"] as const;

/**
 * Prefixes all console output with `[<id>]`, so the logs of different variants are easy to tell apart. Disposing
 * restores the original console methods; the apps keep the prefix for its whole lifetime.
 */
export function installLogPrefix(id: string): Disposable {
    const prefix = `[${id}]`;
    const originals = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
    };

    for (const method of methods) {
        const original = originals[method];

        console[method] = (...args: unknown[]) => {
            original.call(console, prefix, ...args);
        };
    }

    return {
        [Symbol.dispose]: () => {
            Object.assign(console, originals);
        },
    };
}
