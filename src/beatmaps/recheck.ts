import type { Config } from "@/config/config";
import { RankedStatus } from "@rian8337/osu-base";

/**
 * How long a cached beatmap of this status is trusted before its status is re-checked with osu!, in milliseconds.
 * Ranked, approved, and loved beatmaps cannot change or be removed, so they are never re-checked (`null`). An
 * unknown status is treated as pending.
 */
export function getRecheckIntervalMs(
    status: RankedStatus,
    minutes: Config["recheckMinutes"],
): number | null {
    switch (status) {
        case RankedStatus.Ranked:
        case RankedStatus.Approved:
        case RankedStatus.Loved:
            return null;
        case RankedStatus.Qualified:
            return minutes.qualified * 60_000;
        case RankedStatus.Graveyard:
            return minutes.graveyard * 60_000;
        default:
            return minutes.pending * 60_000;
    }
}

/**
 * The re-check interval of a set: that of its most volatile status. A set without osu!standard beatmaps (whose
 * status is unknown) is re-checked like a graveyard beatmap.
 */
export function getBeatmapsetRecheckIntervalMs(
    statuses: readonly RankedStatus[],
    minutes: Config["recheckMinutes"],
): number | null {
    if (statuses.length === 0) {
        return minutes.graveyard * 60_000;
    }

    const intervals = statuses
        .map((status) => getRecheckIntervalMs(status, minutes))
        .filter((interval) => interval !== null);

    return intervals.length > 0 ? Math.min(...intervals) : null;
}

/**
 * Whether something last checked at `lastChecked` is due for a re-check.
 */
export function isRecheckDue(
    lastChecked: Date,
    intervalMs: number | null,
    now = Date.now(),
): boolean {
    return intervalMs !== null && lastChecked.getTime() < now - intervalMs;
}
