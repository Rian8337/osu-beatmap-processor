/**
 * Shares one pending operation per key: callers that ask for a key while its operation runs get the same promise.
 * The entry is removed before the shared promise settles, so a caller that retries from its own rejection handler starts afresh.
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

        let operation: Promise<V>;

        try {
            operation = start();
        } catch (error) {
            // A synchronous throw never registers an entry, so there is nothing to clean up.
            return Promise.reject(error);
        }

        // The entry is deleted in the same chain that settles the shared promise, so it is gone before any caller resumes.
        const shared: Promise<V> = operation.finally(() => {
            if (this.pendingPromises.get(key) === shared) {
                this.pendingPromises.delete(key);
            }
        });

        this.pendingPromises.set(key, shared);

        return shared;
    }
}
