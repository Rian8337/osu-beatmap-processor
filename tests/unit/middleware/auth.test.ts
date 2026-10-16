import type { ApiKeyRecord } from "@/access/types";
import { findCaller } from "@/http/requestContext";
import { createAuthMiddleware } from "@/middleware/auth";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

const bot: ApiKeyRecord = {
    name: "bot",
    lane: "priority",
    rateLimitPerMinute: null,
};

function createApp(allowAnonymous = true) {
    return express()
        .use(
            createAuthMiddleware(
                {
                    authenticate: (raw) =>
                        raw === "good-key" ? bot : undefined,
                },
                { allowAnonymous },
            ),
        )
        .get("/", (_req, res) => {
            res.json(findCaller(res));
        });
}

describe("auth middleware", () => {
    it("accepts a key in the header or the query", async () => {
        for (const send of [
            request(createApp()).get("/").set("X-Api-Key", "good-key"),
            request(createApp()).get("/?key=good-key"),
            request(createApp())
                .get("/?key=good-key")
                .set("X-Api-Key", "good-key"),
        ]) {
            const response = await send.expect(200);

            expect(response.body).toEqual({ kind: "key", key: bot });
        }
    });

    it("treats a request without a key as anonymous", async () => {
        const response = await request(createApp()).get("/").expect(200);

        expect(response.body).toEqual({ kind: "anonymous" });
    });

    it("requires a key when anonymous access is off", async () => {
        const missing = await request(createApp(false)).get("/");
        const present = await request(createApp(false)).get("/?key=good-key");

        expect(missing.status).toBe(401);
        expect(missing.body).toEqual({ error: "API key required" });
        expect(present.status).toBe(200);
    });

    it.each([
        ["/?key=wrong", undefined],
        ["/?key=", undefined],
        ["/?key=good-key&key=good-key", undefined],
        ["/", ""],
        ["/", "wrong"],
        ["/?key=good-key", "other"],
    ])("rejects %s with header %j", async (path, header) => {
        const send = request(createApp()).get(path);

        if (header !== undefined) {
            send.set("X-Api-Key", header);
        }

        const response = await send;

        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: "Unauthorized" });
    });

    it("rejects conflicting or repeated keys even when every key is valid", async () => {
        const app = express()
            .use(
                createAuthMiddleware(
                    { authenticate: () => bot },
                    { allowAnonymous: true },
                ),
            )
            .get("/", (_req, res) => {
                res.json(findCaller(res));
            });

        const conflicting = await request(app)
            .get("/?key=a")
            .set("X-Api-Key", "b");
        const repeated = await request(app).get("/?key=a&key=b");
        const matching = await request(app)
            .get("/?key=a")
            .set("X-Api-Key", "a");

        expect(conflicting.status).toBe(401);
        expect(repeated.status).toBe(401);
        expect(matching.status).toBe(200);
    });
});
