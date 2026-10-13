import { convertApiResponseToRow } from "@/beatmaps/converter";
import type { BeatmapRow } from "@/database/types";
import { buildApiBeatmap } from "@test/fixtures/osu/beatmaps";
import type { OsuAPIResponse } from "@rian8337/osu-base";

/**
 * A beatmap row built from a fixture API response, checked at `checkedAt` (default: now).
 */
export function buildBeatmapRow(
    overrides: Partial<OsuAPIResponse> = {},
    checkedAt = new Date(),
): BeatmapRow {
    return convertApiResponseToRow(buildApiBeatmap(overrides), checkedAt);
}
