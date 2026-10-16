import type { BeatmapReference } from "@/beatmaps/validation";
import type { BeatmapRow } from "@/database/types";
import type { Lane } from "@/osu/errors";

export interface IBeatmapService {
    /**
     * The beatmap from memory, the database, or osu!, re-checked with osu! when its status's interval has passed
     * and the budget is idle. `null` if osu! has no such osu!standard beatmap.
     *
     * @throws {DatabaseUnavailableError} If the database cannot be read (osu! is not asked).
     * @throws {OsuUnavailableError} If the beatmap is not cached and osu! cannot be asked.
     */
    getBeatmap(
        lane: Lane,
        reference: BeatmapReference,
    ): Promise<BeatmapRow | null>;

    /**
     * Fetches the beatmap from osu! now (waiting for the budget) and stores it. `null` if osu! no longer has it.
     *
     * @throws {OsuUnavailableError} If osu! cannot be asked.
     */
    refreshBeatmap(lane: Lane, beatmapId: number): Promise<BeatmapRow | null>;

    /** Stores a max combo computed from the beatmap's file. A failed write is logged. */
    setMaxCombo(beatmapId: number, maxCombo: number): Promise<void>;

    /** Puts rows into the memory caches. @returns The frozen copies that were cached. */
    cacheBeatmaps(rows: readonly BeatmapRow[]): readonly BeatmapRow[];

    /** Removes a beatmap from the memory caches. */
    evictBeatmap(row: Pick<BeatmapRow, "beatmapId" | "fileMd5">): void;
}
