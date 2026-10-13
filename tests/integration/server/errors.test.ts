import {
    APIError,
    BadRequestError,
    ServiceUnavailableError,
    UnauthorizedError,
} from "@/server/errors";
import { describe, expect, it } from "vitest";

describe("API errors", () => {
    it("answers with the message as the error body", () => {
        const error = new APIError(418, "I am a teapot");

        expect(error.statusCode).toBe(418);
        expect(error.toResponse()).toEqual({ error: "I am a teapot" });
        expect(error.headers).toEqual({});
        expect(error.name).toBe("APIError");
    });

    it("has the conventional subclasses", () => {
        expect(new BadRequestError("Invalid id").statusCode).toBe(400);
        expect(new UnauthorizedError().toResponse()).toEqual({
            error: "Unauthorized",
        });
        expect(new UnauthorizedError("API key required").message).toBe(
            "API key required",
        );

        const unavailable = new ServiceUnavailableError(
            "Database unavailable",
            5,
        );

        expect(unavailable.statusCode).toBe(503);
        expect(unavailable.headers).toEqual({ "Retry-After": "5" });
        expect(unavailable.name).toBe("ServiceUnavailableError");
    });
});
