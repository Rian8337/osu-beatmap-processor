import type { BeatmapRow } from "@/database/types";

export interface IBeatmapsetRepository {
    /** When the set was last stored complete, `null` if it never was. */
    findLastChecked(beatmapsetId: number): Promise<Date | null>;
    /**
     * In one transaction: deletes the set's stored beatmaps that are not in `rows`, upserts `rows`, and marks the set
     * complete at `checkedAt`. @returns The IDs of the deleted beatmaps.
     */
    replaceBeatmapset(
        beatmapsetId: number,
        rows: readonly BeatmapRow[],
        checkedAt: Date,
    ): Promise<number[]>;
    /** Deletes every stored beatmap of the set and its completeness row. @returns The deleted beatmap IDs. */
    deleteBeatmapset(beatmapsetId: number): Promise<number[]>;
    /** Forgets that the set is complete, so the next set request asks osu!. */
    markIncomplete(beatmapsetId: number): Promise<void>;
}
