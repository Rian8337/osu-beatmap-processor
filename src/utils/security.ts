import { NextFunction, Request, Response } from "express";

/**
 * A middleware to validate whether a given internal key is valid in a GET request.
 */
export function validateGETInternalKey(
    req: Request<unknown, { error?: string }, unknown, { key?: string }>,
    res: Response<{ error?: string }>,
    next: NextFunction,
): void {
    if (
        process.env.INTERNAL_SERVER_KEY &&
        req.query.key !== process.env.INTERNAL_SERVER_KEY
    ) {
        res.status(401).json({ error: "Unauthorized" });

        return;
    }

    next();
}
