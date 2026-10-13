import { APIError, type ErrorResponse } from "@/server/errors";
import type { ErrorRequestHandler } from "express";

// There is deliberately no JSON not-found handler: a `404` with a `{ error: string }` body means "beatmap not
// found" to the dpp processors, so unknown routes keep Express's default HTML 404.

/**
 * Responds to errors that reach Express: API errors with their status, anything else with a 500.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
        next(error);

        return;
    }

    if (error instanceof APIError) {
        res.status(error.statusCode)
            .set(error.headers)
            .json(error.toResponse());

        return;
    }

    console.error("[Unhandled Error]:", error);

    res.status(500).json({
        error: "Internal server error",
    } satisfies ErrorResponse);
};
