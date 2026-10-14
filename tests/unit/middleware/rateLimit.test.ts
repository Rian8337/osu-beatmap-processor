import type { ApiKeyRecord, Caller } from "@/access/types";
import { anonymousCaller } from "@/access/types";
import { setCaller } from "@/http/requestContext";
import { createRateLimitMiddleware } from "@/middleware/rateLimit";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const key = (
    name: string,
    rateLimitPerMinute: number | null,
): ApiKeyRecord => ({
    name,
    lane: "bulk",
    rateLimitPerMinute,
});

const callers: Record<string, Caller> = {
    limited: { kind: "key", key: key("limited", 2) },
    other: { kind: "key", key: key("other", 2) },
    unlimited: { kind: "key", key: key("unlimited", null) },
};

function createApp() {
    return express()
        .use((req, res, next) => {
            const name = req.get("x-caller");

            setCaller(res, (name && callers[name]) || anonymousCaller);
            next();
        })
        .use(createRateLimitMiddleware({ anonymousLimit: 1 }))
        .get("/", (_req, res) => {
            res.json({ ok: true });
        });
}

describe("rate limit middleware", () => {
    it("limits each key by its own per-minute limit, with standard headers", async () => {
        const warn = vi
            .spyOn(console, "warn")
            .mockImplementation(() => undefined);
        const app = createApp();
        const send = (caller: string) =>
            request(app).get("/").set("X-Caller", caller);

        expect(
            (await send("limited")).headers["ratelimit-policy"],
        ).toBeDefined();
        await send("limited").expect(200);
        await send("limited").expect(429, { error: "Rate limit exceeded" });
        await send("other").expect(200);
        expect(warn).toHaveBeenCalledWith("Rate limit reached by key limited");
    });

    it("never limits unlimited keys", async () => {
        const app = createApp();

        for (let i = 0; i < 10; i++) {
            const response = await request(app)
                .get("/")
                .set("X-Caller", "unlimited");

            expect(response.status).toBe(200);
            expect(response.headers["ratelimit-policy"]).toBeUndefined();
        }
    });

    it("limits anonymous callers per IP without logging each rejection", async () => {
        const warn = vi
            .spyOn(console, "warn")
            .mockImplementation(() => undefined);
        const app = createApp();

        await request(app).get("/").expect(200);
        await request(app).get("/").expect(429);
        expect(warn).not.toHaveBeenCalled();
    });

    it("ignores X-Forwarded-For unless a proxy is trusted", async () => {
        const app = createApp();

        const first = await request(app)
            .get("/")
            .set("X-Forwarded-For", "10.0.0.1");
        const second = await request(app)
            .get("/")
            .set("X-Forwarded-For", "10.0.0.2");

        expect(first.status).toBe(200);
        expect(second.status).toBe(429);
    });
});
