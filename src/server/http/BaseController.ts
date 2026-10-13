import { APIError, type ErrorResponse } from "@/server/errors";
import type { Response } from "express";

/**
 * Base class for controllers.
 */
export abstract class BaseController {
    /**
     * Sends the response for an error thrown by a handler. Unexpected errors are logged and reported as a 500
     * without details.
     */
    protected handleError(res: Response, error: unknown): void {
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
    }
}
