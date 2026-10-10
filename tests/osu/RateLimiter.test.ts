import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OsuUnavailableError } from "../../src/osu/errors.js";
import {
    RateLimiter,
    type RateLimiterOptions,
} from "../../src/osu/RateLimiter.js";

const relaxed: RateLimiterOptions = {
    ratesPerMinute: { api: 60, file: 60, total: 60 },
    bulkShare: 0.5,
    maxWaitMs: { priority: 600_000, bulk: 600_000 },
};

/**
 * Schedules a call that records when it started (fake time) and its label.
 */
function recorder() {
    const starts: { label: string; at: number }[] = [];

    return {
        starts,
        task: (label: string) => (): Promise<string> => {
            starts.push({ label, at: Date.now() });

            return Promise.resolve(label);
        },
    };
}

function gaps(starts: { at: number }[]): number[] {
    return starts.slice(1).map((start, i) => start.at - (starts[i]?.at ?? 0));
}

describe("RateLimiter", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-10T00:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("paces calls through a kind queue and the total queue at the lower rate", async () => {
        const limiter = new RateLimiter({
            ...relaxed,
            ratesPerMinute: { api: 60, file: 60, total: 30 },
        });
        const { starts, task } = recorder();
        const done = Promise.all(
            ["a", "b", "c"].map((label) =>
                limiter.schedule("priority", "api", task(label)),
            ),
        );

        await vi.advanceTimersByTimeAsync(10_000);
        await done;

        expect(starts.map((s) => s.label)).toEqual(["a", "b", "c"]);

        for (const gap of gaps(starts)) {
            expect(gap).toBeGreaterThanOrEqual(2000);
        }
    });

    it("keeps API and file calls together under the total rate", async () => {
        const limiter = new RateLimiter({
            ...relaxed,
            ratesPerMinute: { api: 60, file: 60, total: 30 },
        });
        const { starts, task } = recorder();
        const done = Promise.all([
            limiter.schedule("priority", "api", task("api-1")),
            limiter.schedule("priority", "file", task("file-1")),
            limiter.schedule("priority", "api", task("api-2")),
            limiter.schedule("priority", "file", task("file-2")),
        ]);

        await vi.advanceTimersByTimeAsync(20_000);
        await done;

        expect(starts).toHaveLength(4);

        for (const gap of gaps(starts)) {
            expect(gap).toBeGreaterThanOrEqual(2000);
        }
    });

    it("starts a priority call before a bulk call already waiting on a shared queue", async () => {
        // With a full share, the bulk call passes its own queue at once and waits on the shared API queue.
        const limiter = new RateLimiter({ ...relaxed, bulkShare: 1 });
        const { starts, task } = recorder();
        const first = limiter.schedule("priority", "api", task("priority-1"));
        const bulk = limiter.schedule("bulk", "api", task("bulk"));

        // Let the bulk call reach the shared API queue, behind priority-1's interval.
        await vi.advanceTimersByTimeAsync(0);

        const second = limiter.schedule("priority", "api", task("priority-2"));

        await vi.advanceTimersByTimeAsync(10_000);
        await Promise.all([first, bulk, second]);

        // First come, first served would start "bulk" before "priority-2".
        expect(starts.map((s) => s.label)).toEqual([
            "priority-1",
            "priority-2",
            "bulk",
        ]);
    });

    it("caps bulk at its share without lending idle priority capacity", async () => {
        const limiter = new RateLimiter(relaxed);
        const { starts, task } = recorder();
        const done = Promise.all(
            ["1", "2", "3", "4"].map((label) =>
                limiter.schedule("bulk", "api", task(label)),
            ),
        );

        await vi.advanceTimersByTimeAsync(30_000);
        await done;

        // 60 per minute at a 0.5 share is one call every 2 s, even though priority is idle.
        for (const gap of gaps(starts)) {
            expect(gap).toBeGreaterThanOrEqual(2000);
        }
    });

    it("refuses at once when the estimated wait exceeds the lane's limit", async () => {
        const limiter = new RateLimiter({
            ...relaxed,
            maxWaitMs: { priority: 600_000, bulk: 5000 },
        });
        const { task } = recorder();
        const accepted: Promise<string>[] = [];
        let refusal: unknown;

        for (let i = 0; i < 10; i++) {
            try {
                accepted.push(limiter.schedule("bulk", "api", task(String(i))));
            } catch (e) {
                refusal = e;
                break;
            }
        }

        expect(accepted.length).toBeGreaterThanOrEqual(1);
        expect(accepted.length).toBeLessThan(10);
        expect(refusal).toBeInstanceOf(OsuUnavailableError);
        expect(
            refusal instanceof OsuUnavailableError && refusal.retryAfterSeconds,
        ).toBeGreaterThanOrEqual(5);

        await vi.advanceTimersByTimeAsync(60_000);
        await Promise.all(accepted);
    });

    it("estimates a priority wait only from priority calls ahead of it", async () => {
        // A bulk queue faster than the shared API queue lets several bulk calls reach (and wait in) the latter.
        const limiter = new RateLimiter({ ...relaxed, bulkShare: 4 });
        const { task } = recorder();
        const calls: Promise<string>[] = [];

        for (let i = 0; i < 5; i++) {
            calls.push(
                limiter.schedule("bulk", "api", task(`bulk-${String(i)}`)),
            );
        }

        await vi.advanceTimersByTimeAsync(1000);

        expect(limiter.estimateWaitMs("priority", "api")).toBeLessThanOrEqual(
            1000,
        );
        expect(limiter.estimateWaitMs("bulk", "api")).toBeGreaterThan(3000);

        await vi.advanceTimersByTimeAsync(20_000);
        await Promise.all(calls);
    });

    it("holds queued work during a 429 pause and refuses new work with the remaining pause", async () => {
        expect.assertions(8);

        const limiter = new RateLimiter({
            ...relaxed,
            maxWaitMs: { priority: 8000, bulk: 5000 },
        });
        const { starts, task } = recorder();
        const t0 = Date.now();
        // The first call starts at once; the second waits for the next interval, so it is queued when the pause begins.
        const first = limiter.schedule("priority", "api", task("first"));
        const queued = limiter.schedule("priority", "api", task("queued"));

        limiter.pauseFor(30_000);

        expect(() =>
            limiter.schedule("priority", "file", task("early")),
        ).toThrow(OsuUnavailableError);

        try {
            void limiter.schedule("priority", "api", task("early"));
        } catch (e) {
            expect(e).toBeInstanceOf(OsuUnavailableError);

            // The remaining pause plus two queue intervals (the queued call and this one).
            const retryAfter =
                e instanceof OsuUnavailableError ? e.retryAfterSeconds : 0;

            expect(retryAfter).toBeGreaterThanOrEqual(30);
            expect(retryAfter).toBeLessThanOrEqual(32);
        }

        await vi.advanceTimersByTimeAsync(29_999);

        expect(starts.map((s) => s.label)).toEqual(["first"]);

        await vi.advanceTimersByTimeAsync(1);
        await Promise.all([first, queued]);

        expect(starts.map((s) => s.label)).toEqual(["first", "queued"]);
        expect(starts[1]?.at).toBeGreaterThanOrEqual(t0 + 30_000);

        const after = limiter.schedule("priority", "api", task("after"));

        await vi.advanceTimersByTimeAsync(2000);

        expect(await after).toBe("after");
    });

    it("keeps the longer of overlapping pauses", async () => {
        const limiter = new RateLimiter(relaxed);
        const { starts, task } = recorder();
        const t0 = Date.now();
        const first = limiter.schedule("priority", "api", task("first"));
        const queued = limiter.schedule("priority", "api", task("queued"));

        limiter.pauseFor(20_000);
        limiter.pauseFor(5000);

        await vi.advanceTimersByTimeAsync(19_999);

        expect(starts.map((s) => s.label)).toEqual(["first"]);

        limiter.pauseFor(40_000);

        await vi.advanceTimersByTimeAsync(30_000);

        expect(starts.map((s) => s.label)).toEqual(["first"]);

        await vi.advanceTimersByTimeAsync(10_000);
        await Promise.all([first, queued]);

        expect(starts[1]?.at).toBeGreaterThanOrEqual(t0 + 19_999 + 40_000);
    });

    it("skips optional work during a pause", async () => {
        const limiter = new RateLimiter(relaxed);
        const optional = vi.fn(() => Promise.resolve("checked"));

        limiter.pauseFor(10_000);

        expect(
            await limiter.tryNow("priority", "api", optional),
        ).toBeUndefined();
        expect(optional).not.toHaveBeenCalled();
    });

    it("runs optional work only when its queues are idle", async () => {
        const limiter = new RateLimiter(relaxed);
        const optional = vi.fn(() => Promise.resolve("checked"));

        const idle = limiter.tryNow("priority", "api", optional);

        await vi.advanceTimersByTimeAsync(2000);

        expect(await idle).toBe("checked");

        const { task } = recorder();
        const busy = [
            limiter.schedule("priority", "api", task("a")),
            limiter.schedule("priority", "api", task("b")),
        ];

        optional.mockClear();

        expect(
            await limiter.tryNow("priority", "api", optional),
        ).toBeUndefined();
        expect(optional).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(10_000);
        await Promise.all(busy);
    });

    it("skips optional work while a queue's interval is still in use, then runs it at once", async () => {
        const limiter = new RateLimiter(relaxed);
        const { task } = recorder();
        const optional = vi.fn(() => Promise.resolve("checked"));

        await limiter.schedule("priority", "api", task("done"));
        await vi.advanceTimersByTimeAsync(50);

        expect(
            await limiter.tryNow("priority", "api", optional),
        ).toBeUndefined();
        expect(optional).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(950);

        // No timer advance after this call: it must start synchronously.
        const result = limiter.tryNow("priority", "api", optional);

        expect(optional).toHaveBeenCalledTimes(1);
        expect(await result).toBe("checked");
    });
});
