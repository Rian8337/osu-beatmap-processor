import { ServiceUnavailableError } from "@/server";
import type { RequestHandler } from "express";

/**
 * `GET /health`: `200 { status: "ok" }` when the database answers, otherwise `503`. Needs no key and is not rate
 * limited, so PM2 and monitoring can call it.
 */
export function createHealthHandler(
    ping: () => Promise<unknown>,
): RequestHandler {
    return async (_req, res) => {
        try {
            await ping();
            res.json({ status: "ok" });
        } catch {
            const error = new ServiceUnavailableError(
                "Database unavailable",
                5,
            );

            res.status(error.statusCode)
                .set(error.headers)
                .json(error.toResponse());
        }
    };
}
