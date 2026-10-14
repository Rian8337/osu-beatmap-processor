import type { BeatmapRow } from "@/database/types";
import type { Lane } from "@/osu/errors";

export interface IBeatmapsetService {
    /**
     * The set's osu!standard beatmaps by beatmap ID (possibly none), from memory, a complete stored set, or osu!.
     * `null` if osu! has no such set.
     *
     * @throws {DatabaseUnavailableError} If the database cannot be read (osu! is not asked).
     * @throws {OsuUnavailableError} If the set is not stored complete and osu! cannot be asked.
     */
    getBeatmapset(
        lane: Lane,
        beatmapsetId: number,
    ): Promise<readonly BeatmapRow[] | null>;
}
