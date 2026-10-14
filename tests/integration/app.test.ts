import { generateApiKey, hashApiKey } from "@/access/keys";
import { dependencyTokens } from "@/dependencies/tokens";
import { KeyRepository } from "@/repositories/KeyRepository";
import { createApp } from "@/app";
import {
    buildApiBeatmap,
    computeFixtureMD5,
    buildOsuFile,
} from "@test/fixtures/osu/beatmaps";
import { startTestApp } from "@test/utils/app";
import { testKeys } from "@test/utils/config";
import { silenceConsoleErrors } from "@test/utils/silenceConsoleErrors";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const key = `key=${testKeys.priority}`;

describe("the app", () => {
    it("runs the early handlers in order before everything else", async () => {
        await using test = await startTestApp();
        const order: string[] = [];
        const app = createApp(
            test.container,
            (_req, _res, next) => {
                order.push("first");
                next();
            },
            (_req, res) => {
                order.push("second");
                res.status(503).json({ error: "Shutting down" });
            },
        );

        // The second handler answers before authentication would have refused the keyless request.
        const response = await request(app).get(
            "/api/beatmap/getbeatmap?id=75",
        );
        expect(response.status).toBe(503);
        expect(response.body).toEqual({ error: "Shutting down" });
        expect(order).toEqual(["first", "second"]);
    });

    it.each([
        ["/api/beatmap/getbeatmap?id=abc", "Invalid id"],
        ["/api/beatmap/getbeatmap?id=0", "Invalid id"],
        ["/api/beatmap/getbeatmap?hash=xyz", "Invalid hash"],
        ["/api/beatmap/getbeatmapfile?id=1&id=2", "Invalid id"],
        ["/api/beatmap/getbeatmaps?id=-1", "Invalid id"],
    ])("answers %s with 400 %s", async (path, error) => {
        await using test = await startTestApp();

        const response = await request(test.app).get(`${path}&${key}`);
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error });
        expect(test.osuStub.requests).toEqual([]);
    });

    it("accepts the key in the X-Api-Key header", async () => {
        await using test = await startTestApp();

        const response = await request(test.app)
            .get("/api/beatmap/getbeatmap?id=75")
            .set("X-Api-Key", testKeys.bulk);
        expect(response.status).toBe(200);
    });

    it("serves /health without a key and reports the database", async () => {
        await using test = await startTestApp({
            config: { anonymousRateLimit: 0 },
        });

        const response = await request(test.app).get("/api/beatmap/health");
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ status: "ok" });

        await test.database[Symbol.asyncDispose]();

        const logged = silenceConsoleErrors();
        const down = await request(test.app).get("/api/beatmap/health");

        expect(down.status).toBe(503);
        expect(down.body).toEqual({ error: "Database unavailable" });
        expect(logged).toHaveBeenCalledOnce();
        expect(logged).toHaveBeenCalledWith(
            "Health check failed:",
            expect.any(String),
        );
    });

    it("maps a database outage to 503 without asking osu!", async () => {
        await using test = await startTestApp();

        await test.database[Symbol.asyncDispose]();

        const logged = silenceConsoleErrors();
        const response = await request(test.app).get(
            `/api/beatmap/getbeatmap?id=75&${key}`,
        );

        expect(logged).toHaveBeenCalledWith(
            "Database read failed:",
            expect.any(String),
        );
        expect(response.status).toBe(503);
        expect(response.headers["retry-after"]).toBe("5");
        expect(response.body).toEqual({ error: "Database unavailable" });
        expect(test.osuStub.requests).toEqual([]);
    });

    it("leaves unknown routes to Express's HTML 404", async () => {
        await using test = await startTestApp();

        for (const path of [`/api/beatmap/nope?${key}`, "/nope"]) {
            const response = await request(test.app).get(path);

            expect(response.status).toBe(404);
            expect(response.headers["content-type"]).toMatch(/^text\/html/);
        }
    });

    it("requires a key when ANON_RATE_LIMIT is 0", async () => {
        await using test = await startTestApp({
            config: { anonymousRateLimit: 0 },
        });

        const response = await request(test.app).get(
            "/api/beatmap/getbeatmap?id=75",
        );
        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: "API key required" });
    });

    it("limits anonymous callers per IP", async () => {
        await using test = await startTestApp({
            config: { anonymousRateLimit: 1 },
        });

        const allowed = await request(test.app).get(
            "/api/beatmap/getbeatmap?id=75",
        );
        expect(allowed.status).toBe(200);
        const limited = await request(test.app).get(
            "/api/beatmap/getbeatmap?id=75",
        );
        expect(limited.status).toBe(429);
        expect(limited.body).toEqual({ error: "Rate limit exceeded" });
    });

    it("serves database keys with their limits, and stops serving revoked ones after a reload", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        await using test = await startTestApp();
        const keys = new KeyRepository(test.database.db);
        const raw = generateApiKey();

        await keys.insert({
            name: "site",
            keyHash: hashApiKey(raw),
            lane: "bulk",
            rateLimitPerMinute: 1,
        });

        const service = test.container.resolve(dependencyTokens.keyService);

        await service.reload();
        const served = await request(test.app).get(
            `/api/beatmap/getbeatmap?id=75&key=${raw}`,
        );
        expect(served.status).toBe(200);
        const limited = await request(test.app).get(
            `/api/beatmap/getbeatmap?id=75&key=${raw}`,
        );
        expect(limited.status).toBe(429);
        expect(limited.body).toEqual({ error: "Rate limit exceeded" });

        await keys.revoke("site");
        await service.reload();
        const revoked = await request(test.app).get(
            `/api/beatmap/getbeatmap?id=75&key=${raw}`,
        );
        expect(revoked.status).toBe(401);
        expect(revoked.body).toEqual({ error: "Unauthorized" });
    });

    it("stores a downloaded file and backfills a missing max combo", async () => {
        const file = buildOsuFile(78, "Extra");
        await using test = await startTestApp();

        test.osuState.beatmaps.push(
            buildApiBeatmap({
                beatmap_id: "78",
                max_combo: null,
                file_md5: computeFixtureMD5(file),
            }),
        );
        test.osuState.files.set(78, file);

        const response = await request(test.app)
            .get(`/api/beatmap/getbeatmapfile?id=78&${key}`)
            .expect(200);

        expect(response.text).toBe(file.toString());

        const beatmaps = test.container.resolve(
            dependencyTokens.beatmapRepository,
        );

        await vi.waitFor(async () =>
            expect((await beatmaps.findById(78))?.maxCombo).toBe(2),
        );

        const again = await request(test.app)
            .get(`/api/beatmap/getbeatmap?id=78&${key}`)
            .expect(200);

        expect(again.body).toMatchObject({ max_combo: "2" });
        // Metadata once, file once; the second request is served from the caches.
        expect(test.osuStub.requests).toHaveLength(2);
    });

    it("answers 500 without details for an unexpected error", async () => {
        const log = silenceConsoleErrors();
        await using test = await startTestApp();

        vi.spyOn(
            test.container.resolve(dependencyTokens.beatmapService),
            "getBeatmap",
        ).mockRejectedValue(new Error("boom"));

        const response = await request(test.app).get(
            `/api/beatmap/getbeatmap?id=75&${key}`,
        );
        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: "Internal server error" });
        expect(log).toHaveBeenCalled();
    });

    it("counts anonymous callers per forwarded address when trustProxy is on", async () => {
        await using test = await startTestApp({
            config: { anonymousRateLimit: 1, trustProxy: true },
        });
        const get = (address: string) =>
            request(test.app)
                .get("/api/beatmap/getbeatmap?id=75")
                .set("X-Forwarded-For", address);

        const statuses = [
            (await get("203.0.113.1")).status,
            (await get("203.0.113.2")).status,
            (await get("203.0.113.1")).status,
        ];

        expect(statuses).toEqual([200, 200, 429]);
    });

    it("ignores X-Forwarded-For when trustProxy is off", async () => {
        await using test = await startTestApp({
            config: { anonymousRateLimit: 1, trustProxy: false },
        });
        const get = (address: string) =>
            request(test.app)
                .get("/api/beatmap/getbeatmap?id=75")
                .set("X-Forwarded-For", address);

        const statuses = [
            (await get("203.0.113.1")).status,
            (await get("203.0.113.2")).status,
        ];

        expect(statuses).toEqual([200, 429]);
    });

    it("authenticates before rate limiting and never logs the request URL", async () => {
        const logs = [
            vi.spyOn(console, "log").mockImplementation(() => undefined),
            vi.spyOn(console, "info").mockImplementation(() => undefined),
            vi.spyOn(console, "warn").mockImplementation(() => undefined),
            vi.spyOn(console, "error").mockImplementation(() => undefined),
        ];
        await using test = await startTestApp();

        const allowed = await request(test.app).get(
            `/api/beatmap/getbeatmap?id=75&${key}`,
        );
        expect(allowed.status).toBe(200);
        const limited = await request(test.app).get(
            "/api/beatmap/getbeatmap?id=75&key=wrong-key-value",
        );
        expect(limited.status).toBe(401);
        expect(limited.body).toEqual({ error: "Unauthorized" });

        for (const log of logs) {
            expect(JSON.stringify(log.mock.calls)).not.toContain("key=");
            expect(JSON.stringify(log.mock.calls)).not.toContain(
                testKeys.priority,
            );
        }
    });
});
