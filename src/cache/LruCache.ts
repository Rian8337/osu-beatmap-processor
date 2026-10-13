interface Entry<V> {
    readonly value: V;
    readonly expiresAt: number;
}

/**
 * A bounded cache that evicts the least recently used entry, with optional expiry.
 */
export class LruCache<K, V> {
    private readonly entries = new Map<K, Entry<V>>();

    /**
     * @param maxEntries The maximum number of entries.
     * @param ttlMs How long an entry lives, in milliseconds. Defaults to forever.
     * @param now The clock to use. Defaults to `Date.now`.
     */
    constructor(
        private readonly maxEntries: number,
        private readonly ttlMs = Number.POSITIVE_INFINITY,
        private readonly now: () => number = Date.now,
    ) {}

    get size(): number {
        return this.entries.size;
    }

    get(key: K): V | undefined {
        const entry = this.entries.get(key);

        if (!entry) {
            return undefined;
        }

        this.entries.delete(key);

        if (entry.expiresAt <= this.now()) {
            return undefined;
        }

        // Re-insert to mark as most recently used.
        this.entries.set(key, entry);

        return entry.value;
    }

    set(key: K, value: V): void {
        this.entries.delete(key);
        this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });

        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next();

            if (oldest.done) {
                break;
            }

            this.entries.delete(oldest.value);
        }
    }

    delete(key: K): void {
        this.entries.delete(key);
    }
}
