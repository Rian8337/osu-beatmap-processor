import type { NextFunction, Request, Response } from "express";
import { getConfig } from "../config.js";
import type { Lane } from "../osu/errors.js";
import { setLane } from "./lane.js";

/**
 * The lane for a request key: the bulk key gives `bulk`; the internal key (or any key, when no internal key is
 * configured) gives `priority`; anything else is rejected.
 */
export function resolveLane(
    key: string | undefined,
    keys: { internal: string | undefined; bulk: string | undefined },
): Lane | null {
    if (keys.bulk !== undefined && key === keys.bulk) {
        return "bulk";
    }

    if (keys.internal === undefined || key === keys.internal) {
        return "priority";
    }

    return null;
}

/**
 * A middleware to validate the key of a GET request and record its lane.
 */
export function validateGETInternalKey(
    req: Request<unknown, { error?: string }, unknown, { key?: string }>,
    res: Response<{ error?: string }>,
    next: NextFunction,
): void {
    const { internalServerKey, bulkServerKey } = getConfig();
    const lane = resolveLane(req.query.key, {
        internal: internalServerKey,
        bulk: bulkServerKey,
    });

    if (!lane) {
        res.status(401).json({ error: "Unauthorized" });

        return;
    }

    setLane(res, lane);
    next();
}
