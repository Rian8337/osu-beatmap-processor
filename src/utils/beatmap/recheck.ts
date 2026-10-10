import { RankedStatus, type OsuAPIResponse } from "@rian8337/osu-base";
import type { Config } from "../../config.js";
import { OsuUnavailableError, type Lane } from "../../osu/errors.js";
import type { OsuGateway } from "../../osu/OsuGateway.js";

/**
 * How long a cached beatmap of this status is trusted before its status is re-checked with osu!, in
 * milliseconds. Ranked, approved, and loved beatmaps cannot change or be removed, so they are never re-checked
 * (`null`). An updated beatmap gets a new MD5 hash, so lookups by hash find new versions regardless; re-checks
 * only matter for lookups by ID and for status changes.
 */
export function recheckIntervalMs(
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
        case RankedStatus.Pending:
        case RankedStatus.Wip:
            return minutes.pending * 60_000;
        case RankedStatus.Graveyard:
            return minutes.graveyard * 60_000;
    }
}

export type RecheckOutcome =
    | { readonly kind: "skipped" }
    | { readonly kind: "gone" }
    | { readonly kind: "fresh"; readonly beatmap: OsuAPIResponse };

/**
 * The optional status re-check of a cached unranked beatmap. It never fails a request: when the limiter is busy
 * or osu! is unavailable, it is skipped and the cached beatmap is served.
 */
export async function recheckBeatmap(
    gateway: Pick<OsuGateway, "tryGetBeatmapNow">,
    lane: Lane,
    beatmapId: number,
): Promise<RecheckOutcome> {
    let beatmap: OsuAPIResponse | null | undefined;

    try {
        beatmap = await gateway.tryGetBeatmapNow(lane, beatmapId);
    } catch (e) {
        if (e instanceof OsuUnavailableError) {
            return { kind: "skipped" };
        }

        throw e;
    }

    if (beatmap === undefined) {
        return { kind: "skipped" };
    }

    return beatmap === null ? { kind: "gone" } : { kind: "fresh", beatmap };
}
