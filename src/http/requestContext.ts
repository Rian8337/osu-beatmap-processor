import type { Caller } from "@/access/types";
import type { Response } from "express";

// Keyed by response object, so per-request state stays typed instead of living in `res.locals`.
const callers = new WeakMap<Response, Caller>();

export function setCaller(res: Response, caller: Caller): void {
    callers.set(res, caller);
}

/**
 * The caller of a request that passed the auth middleware.
 *
 * @throws {Error} If the auth middleware has not run for this response.
 */
export function getCaller(res: Response): Caller {
    const caller = callers.get(res);

    if (!caller) {
        throw new Error("The auth middleware has not run for this request");
    }

    return caller;
}

/**
 * The caller, or `undefined` if the request was rejected before it was authenticated.
 */
export function findCaller(res: Response): Caller | undefined {
    return callers.get(res);
}
