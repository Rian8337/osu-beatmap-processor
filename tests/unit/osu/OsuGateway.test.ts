import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OsuUnavailableError } from "@/osu/errors";
import { OsuGateway } from "@/osu/OsuGateway";
import { RateLimiter } from "@/osu/RateLimiter";
import { startStubOsu, type StubOsu } from "@test/utils/stubOsu";

const apiKey = "secret-osu-key";

function beatmap(id: number, mode = "0") {
    return {
        beatmap_id: id.toString(),
        beatmapset_id: "1",
        file_md5: "0123456789abcdef0123456789abcdef",
        mode,
    };
}

describe("OsuGateway", () => {
    let stub: StubOsu;
    let limiter: RateLimiter;
    let gateway: OsuGateway;

    beforeEach(async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        stub = await startStubOsu();
        // Fast limits so tests do not wait; pacing itself is tested in RateLimiter.test.ts.
        limiter = new RateLimiter({
            ratesPerMinute: { api: 60_000, file: 60_000, total: 60_000 },
            bulkShare: 1,
            maxWaitMs: { priority: 60_000, bulk: 60_000 },
        });
        gateway = new OsuGateway({
            apiKey,
            apiBaseUrl: `${stub.url}/api`,
            fileBaseUrl: `${stub.url}/osu`,
            rateLimiter: limiter,
            timeoutMs: 200,
        });
    });

    afterEach(() => stub[Symbol.asyncDispose]());

    const json =
        (body: unknown) =>
        (_req: unknown, res: import("node:http").ServerResponse) => {
            res.writeHead(200, { "Content-Type": "application/json" }).end(
                JSON.stringify(body),
            );
        };

    it("asks get_beatmaps by ID or hash with the key, and returns the osu!standard beatmap", async () => {
        stub.handle(json([beatmap(5)]));

        expect(await gateway.getBeatmap("priority", 5)).toMatchObject({
            beatmap_id: "5",
        });
        expect(
            await gateway.getBeatmap(
                "priority",
                "0123456789abcdef0123456789abcdef",
            ),
        ).toMatchObject({ beatmap_id: "5" });
        expect(stub.requests).toEqual([
            `/api/get_beatmaps?k=${apiKey}&b=5`,
            `/api/get_beatmaps?k=${apiKey}&h=0123456789abcdef0123456789abcdef`,
        ]);
    });

    it("encodes a hash so it cannot add osu! query parameters", async () => {
        stub.handle(json([beatmap(5)]));

        await gateway.getBeatmap("priority", "x&s=1");

        expect(stub.requests).toEqual([
            `/api/get_beatmaps?k=${apiKey}&h=x%26s%3D1`,
        ]);
    });

    it("treats an empty result or a non-standard beatmap as not found", async () => {
        stub.handle(json([]));

        expect(await gateway.getBeatmap("priority", 1)).toBeNull();
        expect(await gateway.getBeatmapset("priority", 1)).toBeNull();

        stub.handle(json([beatmap(2, "3")]));

        expect(await gateway.getBeatmap("priority", 2)).toBeNull();
    });

    it("returns every beatmap of a beatmapset", async () => {
        stub.handle(json([beatmap(1), beatmap(2, "1")]));

        expect(await gateway.getBeatmapset("bulk", 9)).toHaveLength(2);
        expect(stub.requests).toEqual([`/api/get_beatmaps?k=${apiKey}&s=9`]);
    });

    it("downloads files, treating 404 and an empty body as not found", async () => {
        stub.handle((req, res) => {
            if (req.url === "/osu/1") {
                res.writeHead(200).end("osu file format v14");
            } else if (req.url === "/osu/2") {
                res.writeHead(200).end();
            } else {
                res.writeHead(404).end();
            }
        });

        expect((await gateway.downloadFile("priority", 1))?.toString()).toBe(
            "osu file format v14",
        );
        expect(await gateway.downloadFile("priority", 2)).toBeNull();
        expect(await gateway.downloadFile("priority", 3)).toBeNull();
    });

    it("pauses the limiter on 429, fails with its Retry-After, and never retries", async () => {
        const pauseFor = vi.spyOn(limiter, "pauseFor");

        stub.handle((_req, res) => {
            res.writeHead(429, { "Retry-After": "42" }).end();
        });

        const attempt = gateway.getBeatmap("priority", 1);

        await expect(attempt).rejects.toBeInstanceOf(OsuUnavailableError);
        await expect(attempt).rejects.toMatchObject({ retryAfterSeconds: 42 });
        expect(pauseFor).toHaveBeenCalledWith(42_000);
        expect(stub.requests).toHaveLength(1);
        expect(
            JSON.stringify(vi.mocked(console.warn).mock.calls),
        ).not.toContain(apiKey);
    });

    it.each([
        ["99999999", 3600],
        ["0.5", 1],
        ["2.2", 3],
    ])("rounds up and caps Retry-After %s to %d s", async (header, seconds) => {
        const pauseFor = vi.spyOn(limiter, "pauseFor");

        stub.handle((_req, res) => {
            res.writeHead(429, { "Retry-After": header }).end();
        });

        await expect(gateway.getBeatmap("priority", 1)).rejects.toMatchObject({
            retryAfterSeconds: seconds,
        });
        expect(pauseFor).toHaveBeenCalledWith(seconds * 1000);
    });

    it("uses 60 seconds when a 429 has no Retry-After", async () => {
        const pauseFor = vi.spyOn(limiter, "pauseFor");

        stub.handle((_req, res) => {
            res.writeHead(429).end();
        });

        await expect(gateway.downloadFile("bulk", 1)).rejects.toMatchObject({
            retryAfterSeconds: 60,
        });
        expect(pauseFor).toHaveBeenCalledWith(60_000);
    });

    it.each([
        [
            "a 5xx",
            (res: import("node:http").ServerResponse) =>
                res.writeHead(502).end(),
        ],
        [
            "an unparsable body",
            (res: import("node:http").ServerResponse) =>
                res
                    .writeHead(200, { "Content-Type": "application/json" })
                    .end("{"),
        ],
        [
            "a non-array body",
            (res: import("node:http").ServerResponse) =>
                res.writeHead(200, { "Content-Type": "application/json" }).end(
                    JSON.stringify({
                        error: "Please provide a valid API key.",
                    }),
                ),
        ],
    ])(
        "fails as unavailable on %s, once, without leaking the key",
        async (_case, reply) => {
            stub.handle((_req, res) => {
                reply(res);
            });

            await expect(
                gateway.getBeatmap("priority", 1),
            ).rejects.toBeInstanceOf(OsuUnavailableError);
            expect(stub.requests).toHaveLength(1);
            expect(
                JSON.stringify(vi.mocked(console.error).mock.calls),
            ).not.toContain(apiKey);
        },
    );

    it("fails as unavailable on a timeout or when osu! cannot be reached", async () => {
        stub.handle(() => {
            // Never respond.
        });

        await expect(gateway.getBeatmap("priority", 1)).rejects.toBeInstanceOf(
            OsuUnavailableError,
        );

        const unreachable = new OsuGateway({
            apiKey,
            apiBaseUrl: "http://127.0.0.1:1/api",
            fileBaseUrl: "http://127.0.0.1:1/osu",
            rateLimiter: limiter,
            timeoutMs: 200,
        });

        await expect(
            unreachable.downloadFile("priority", 1),
        ).rejects.toBeInstanceOf(OsuUnavailableError);
    });

    it("shares one request between concurrent calls in the same lane, but not across lanes", async () => {
        let release: () => void = () => undefined;
        const released = new Promise<void>((resolve) => {
            release = resolve;
        });

        stub.handle((_req, res) => {
            void released.then(() => {
                json([beatmap(1)])(undefined, res);
            });
        });

        const calls = [
            gateway.getBeatmap("bulk", 1),
            gateway.getBeatmap("bulk", 1),
            gateway.getBeatmap("priority", 1),
        ];

        await vi.waitFor(() => {
            expect(stub.requests).toHaveLength(2);
        });
        release();

        const results = await Promise.all(calls);

        expect(results.every((r) => r?.beatmap_id === "1")).toBe(true);
        expect(stub.requests).toHaveLength(2);
    });

    it("skips an optional lookup when the limiter is busy", async () => {
        const tryNow = vi.spyOn(limiter, "tryNow").mockResolvedValue(undefined);

        expect(await gateway.tryGetBeatmapNow("priority", 1)).toBeUndefined();
        expect(tryNow).toHaveBeenCalledOnce();
        expect(stub.requests).toEqual([]);
    });

    it("lists osu!standard beatmaps approved since a date, 500 at a time", async () => {
        stub.handle(json([beatmap(5), beatmap(6)]));

        expect(
            await gateway.getBeatmapsSince(
                "bulk",
                new Date("2007-01-02T03:04:05Z"),
            ),
        ).toHaveLength(2);
        expect(stub.requests).toEqual([
            `/api/get_beatmaps?k=${apiKey}&since=2007-01-02%2003%3A04%3A05&m=0&limit=500`,
        ]);
    });

    it("re-checks a beatmapset only when the limiter is idle", async () => {
        stub.handle(json([beatmap(5), beatmap(6, "1")]));

        expect(await gateway.tryGetBeatmapsetNow("priority", 1)).toHaveLength(
            2,
        );
        expect(stub.requests).toEqual([`/api/get_beatmaps?k=${apiKey}&s=1`]);

        await new Promise((resolve) => setTimeout(resolve, 5));
        stub.handle(json([]));

        expect(await gateway.tryGetBeatmapsetNow("priority", 2)).toBeNull();

        vi.spyOn(limiter, "tryNow").mockResolvedValue(undefined);

        expect(
            await gateway.tryGetBeatmapsetNow("priority", 1),
        ).toBeUndefined();
        expect(stub.requests).toHaveLength(2);
    });
});
