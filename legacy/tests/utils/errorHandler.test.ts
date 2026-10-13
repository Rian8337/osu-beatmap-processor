import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { OsuUnavailableError } from "../../src/osu/errors.js";
import { osuUnavailableHandler } from "../../src/utils/errorHandler.js";

describe("osuUnavailableHandler", () => {
    it("answers 503 with Retry-After and the error body", async () => {
        const app = express()
            .get("/", () => {
                throw new OsuUnavailableError(12.2);
            })
            .use(osuUnavailableHandler);

        const response = await request(app).get("/");

        expect(response.status).toBe(503);
        expect(response.headers["retry-after"]).toBe("13");
        expect(response.body).toEqual({
            error: "osu! is temporarily unavailable; retry later",
        });
    });

    it("delegates to the next handler once headers are sent", async () => {
        const reached: unknown[] = [];
        const app = express()
            .get("/", (_req, res, next) => {
                res.write("partial");
                next(new OsuUnavailableError(5));
            })
            .use(osuUnavailableHandler)
            .use(
                (
                    error: unknown,
                    _req: express.Request,
                    res: express.Response,
                    // Express identifies error middleware by its four parameters.
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    _next: express.NextFunction,
                ) => {
                    reached.push(error);
                    res.end();
                },
            );

        const response = await request(app).get("/");

        expect(response.status).toBe(200);
        expect(response.text).toBe("partial");
        expect(reached).toHaveLength(1);
        expect(reached[0]).toBeInstanceOf(OsuUnavailableError);
    });

    it("passes other errors on", async () => {
        const app = express()
            .get("/", () => {
                throw new Error("boom");
            })
            .use(osuUnavailableHandler)
            .use(
                (
                    _error: unknown,
                    _req: express.Request,
                    res: express.Response,
                    // Express identifies error middleware by its four parameters.
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    _next: express.NextFunction,
                ) => {
                    res.status(500).json({ error: "other" });
                },
            );

        const response = await request(app).get("/");

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: "other" });
    });
});
