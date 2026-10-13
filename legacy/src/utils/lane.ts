import type { Lane } from "../osu/errors.js";

// Keyed by response, so the lane stays typed instead of living in `res.locals`.
const lanes = new WeakMap<object, Lane>();

export function setLane(res: object, lane: Lane): void {
    lanes.set(res, lane);
}

/**
 * The lane chosen by the request's key.
 *
 * @throws {Error} If the key middleware has not run for this response.
 */
export function getLane(res: object): Lane {
    const lane = lanes.get(res);

    if (!lane) {
        throw new Error("The key middleware has not run for this request");
    }

    return lane;
}
