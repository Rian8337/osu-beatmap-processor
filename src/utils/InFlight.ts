/**
 * Shares one pending operation per key: callers that ask for a key while its operation runs get the same promise.
 * The entry is removed once the operation settles, so a later call starts afresh.
 */
export class InFlight<K, V> {
    private readonly pendingPromises = new Map<K, Promise<V>>();

    get size(): number {
        return this.pendingPromises.size;
    }

    run(key: K, start: () => Promise<V>): Promise<V> {
        const existing = this.pendingPromises.get(key);

        if (existing) {
            return existing;
        }

        // `async` turns a synchronous throw in `start` into a rejection.
        const promise = (async () => start())();

        this.pendingPromises.set(key, promise);
        void promise
            // The caller handles a rejection; this copy only waits for the promise to settle.
            .catch(() => undefined)
            .finally(() => {
                if (this.pendingPromises.get(key) === promise) {
                    this.pendingPromises.delete(key);
                }
            });

        return promise;
    }
}
