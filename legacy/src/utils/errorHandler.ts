import type { ErrorRequestHandler } from "express";
import { OsuUnavailableError } from "../osu/errors.js";

/**
 * Answers `503` with `Retry-After` when osu! could not be asked. Other errors are passed on unchanged.
 */
export const osuUnavailableHandler: ErrorRequestHandler = (
    error,
    _req,
    res,
    next,
) => {
    if (res.headersSent) {
        next(error);

        return;
    }

    if (!(error instanceof OsuUnavailableError)) {
        next(error);

        return;
    }

    res.setHeader("Retry-After", error.retryAfterSeconds.toString());
    res.status(503).json({ error: error.message });
};
