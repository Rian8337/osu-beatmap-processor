import PQueue from "p-queue";
import { OsuUnavailableError, type Lane, type RequestKind } from "./errors.js";

export interface RateLimiterOptions {
    readonly ratesPerMinute: {
        readonly api: number;
        readonly file: number;
        readonly total: number;
    };
    readonly bulkShare: number;
    readonly maxWaitMs: { readonly priority: number; readonly bulk: number };
}

const priorityOf: Record<Lane, number> = { priority: 1, bulk: 0 };

interface PacedQueue {
    readonly queue: PQueue;
    readonly intervalMs: number;
}

function paced(perMinute: number): PacedQueue {
    const intervalMs = Math.ceil(60_000 / perMinute);

    // `strict` keeps a rolling window. The default fixed window can start two tasks one millisecond apart when a
    // task is queued exactly at a window boundary (p-queue schedules a zero-delay timer that resets the count).
    return {
        queue: new PQueue({
            interval: intervalMs,
            intervalCap: 1,
            strict: true,
        }),
        intervalMs,
    };
}

/**
 * Paces outgoing osu! requests. Every request passes through its kind's queue and the total queue (and, for the
 * bulk lane, a bulk queue at `bulkShare` of the rate); each queue starts at most one task per interval. Priority
 * tasks start before waiting bulk tasks on every shared queue.
 */
export class RateLimiter {
    private readonly kindQueues: Record<RequestKind, PacedQueue>;
    private readonly bulkQueues: Record<RequestKind, PacedQueue>;
    private readonly totalQueue: PacedQueue;
    private readonly maxWaitMs: RateLimiterOptions["maxWaitMs"];
    private pausedUntil = 0;
    private resumeTimer: NodeJS.Timeout | undefined;

    constructor(options: RateLimiterOptions) {
        const { ratesPerMinute, bulkShare } = options;

        this.kindQueues = {
            api: paced(ratesPerMinute.api),
            file: paced(ratesPerMinute.file),
        };
        this.totalQueue = paced(ratesPerMinute.total);
        this.bulkQueues = {
            api: paced(
                bulkShare * Math.min(ratesPerMinute.api, ratesPerMinute.total),
            ),
            file: paced(
                bulkShare * Math.min(ratesPerMinute.file, ratesPerMinute.total),
            ),
        };
        this.maxWaitMs = options.maxWaitMs;
    }

    schedule<T>(
        lane: Lane,
        kind: RequestKind,
        fn: () => Promise<T>,
    ): Promise<T> {
        const waitMs = this.estimateWaitMs(lane, kind);

        if (waitMs > this.maxWaitMs[lane]) {
            throw new OsuUnavailableError(waitMs / 1000);
        }

        return this.run(this.path(lane, kind), priorityOf[lane], fn);
    }

    tryNow<T>(
        lane: Lane,
        kind: RequestKind,
        fn: () => Promise<T>,
    ): Promise<T | undefined> {
        const path = this.path(lane, kind);
        const idle =
            this.remainingPauseMs() === 0 &&
            path.every(({ queue }) => queue.size === 0 && queue.pending === 0);

        return idle
            ? this.run(path, priorityOf[lane], fn)
            : Promise.resolve(undefined);
    }

    estimateWaitMs(lane: Lane, kind: RequestKind): number {
        const queueWaitMs = Math.max(
            ...this.path(lane, kind).map(({ queue, intervalMs }) => {
                const ahead =
                    lane === "priority"
                        ? queue.sizeBy({ priority: priorityOf.priority })
                        : queue.size;

                return (ahead + 1) * intervalMs;
            }),
        );

        return queueWaitMs + this.remainingPauseMs();
    }

    pauseFor(ms: number): void {
        const until = Date.now() + ms;

        if (until <= this.pausedUntil) {
            return;
        }

        this.pausedUntil = until;

        for (const { queue } of this.allQueues()) {
            queue.pause();
        }

        clearTimeout(this.resumeTimer);
        this.resumeTimer = setTimeout(() => {
            this.resumeTimer = undefined;

            for (const { queue } of this.allQueues()) {
                queue.start();
            }
        }, ms);
        this.resumeTimer.unref();
    }

    private remainingPauseMs(): number {
        return Math.max(0, this.pausedUntil - Date.now());
    }

    private path(lane: Lane, kind: RequestKind): PacedQueue[] {
        const shared = [this.kindQueues[kind], this.totalQueue];

        return lane === "bulk" ? [this.bulkQueues[kind], ...shared] : shared;
    }

    private allQueues(): PacedQueue[] {
        return [
            this.kindQueues.api,
            this.kindQueues.file,
            this.totalQueue,
            this.bulkQueues.api,
            this.bulkQueues.file,
        ];
    }

    private run<T>(
        path: readonly PacedQueue[],
        priority: number,
        fn: () => Promise<T>,
    ): Promise<T> {
        // Wrap `fn` from the innermost (last) queue outwards, so it starts once every queue has released it.
        return path.reduceRight<() => Promise<T>>(
            (inner, { queue }) =>
                () =>
                    queue.add(inner, { priority }),
            fn,
        )();
    }
}
