/**
 * A map that removes data that were unused for a specified duration.
 */
export class TimeConstrainedMap<K, V> extends Map<K, V> {
    /**
     * The epoch time at which a data is added, in milliseconds.
     */
    private readonly addedTime = new Map<K, number>();

    /**
     * The interval at which this timed map will be sweeped, in seconds.
     */
    private readonly sweepInterval = 300;

    /**
     * The lifetime of each cache data in this timed map.
     */
    private readonly lifetime: number;

    private interval?: NodeJS.Timeout;

    /**
     * @param lifetime The lifetime of each data in the map, in seconds.
     */
    constructor(lifetime: number) {
        super();

        this.lifetime = lifetime;

        if (lifetime <= 0) {
            throw new RangeError(
                `Invalid limited collection lifetime: ${lifetime.toString()}`,
            );
        }
    }

    /**
     * Starts an interval to periodically sweep data that
     * were unused for the specified duration.
     */
    private startInterval(): void {
        this.interval ??= setInterval(() => {
            const executionTime = Date.now();

            for (const [key, addedTime] of this.addedTime) {
                if (executionTime - addedTime > this.lifetime * 1000) {
                    this.addedTime.delete(key);
                    this.delete(key);
                }
            }

            if (this.size === 0) {
                clearInterval(this.interval);
                this.interval = undefined;
            }
        }, this.sweepInterval * 1000);
    }

    override set(key: K, value: V): this {
        super.set(key, value);

        this.startInterval();
        this.addedTime.set(key, Date.now());

        return this;
    }
}
