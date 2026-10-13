/**
 * Which queue lane a request uses: `priority` for the game and other interactive callers, `bulk` for
 * recalculations and other mass traffic.
 */
export type Lane = "priority" | "bulk";

/**
 * Which osu! budget a request spends: `get_beatmaps` calls or `.osu` downloads.
 */
export type RequestKind = "api" | "file";

export const unavailableMessage =
    "osu! is temporarily unavailable; retry later";

/**
 * osu! could not be asked right now: our budget is exhausted, osu! answered `429`, or the request failed.
 * Never means "not found".
 */
export class OsuUnavailableError extends Error {
    readonly retryAfterSeconds: number;

    constructor(retryAfterSeconds: number) {
        super(unavailableMessage);
        this.name = "OsuUnavailableError";
        this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
    }
}
