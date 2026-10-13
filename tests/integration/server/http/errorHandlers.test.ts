import { ServiceUnavailableError } from "@/server/errors";
import { BaseController } from "@/server/http/BaseController";
import { errorHandler } from "@/server/http/errorHandlers";
import express, { type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

class TestController extends BaseController {
    fail(res: Response, error: unknown): void {
        this.handleError(res, error);
    }
}

describe("errorHandler", () => {
    it("answers API errors with their status, headers, and body", async () => {
        const app = express()
            .get("/", () => {
                throw new ServiceUnavailableError("Database unavailable", 5);
            })
            .use(errorHandler);

        const response = await request(app).get("/");

        expect(response.status).toBe(503);
        expect(response.headers["retry-after"]).toBe("5");
        expect(response.body).toEqual({ error: "Database unavailable" });
    });

    it("answers anything else with 500 and logs it", async () => {
        const log = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const app = express()
            .get("/", () => {
                throw new Error("boom");
            })
            .use(errorHandler);

        const response = await request(app).get("/");

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: "Internal server error" });
        expect(log).toHaveBeenCalled();
    });

    it("leaves unknown routes to Express's HTML 404", async () => {
        const response = await request(express().use(errorHandler)).get(
            "/nope",
        );

        expect(response.status).toBe(404);
        expect(response.headers["content-type"]).toMatch(/^text\/html/);
    });
});

describe("BaseController.handleError", () => {
    it("answers API errors and hides unexpected ones", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        const controller = new TestController();
        const app = express()
            .get("/api", (_req, res) =>
                controller.fail(res, new ServiceUnavailableError("down", 7)),
            )
            .get("/other", (_req, res) => controller.fail(res, new Error("x")));

        const api = await request(app).get("/api");

        expect(api.status).toBe(503);
        expect(api.headers["retry-after"]).toBe("7");
        expect(api.body).toEqual({ error: "down" });

        const other = await request(app).get("/other");

        expect(other.status).toBe(500);
        expect(other.body).toEqual({ error: "Internal server error" });
    });
});
