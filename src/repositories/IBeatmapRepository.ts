import type { BeatmapRow } from "@/database/types";

/**
 * Reads throw DatabaseUnavailableError when the database fails; writes throw the driver's error.
 */
export interface IBeatmapRepository {
    findById(id: number): Promise<BeatmapRow | null>;
    findByHash(hash: string): Promise<BeatmapRow | null>;
    findByIds(ids: readonly number[]): Promise<BeatmapRow[]>;
    /** The set's stored beatmaps, by beatmap ID. */
    findByBeatmapsetId(beatmapsetId: number): Promise<BeatmapRow[]>;
    /** Inserts, or replaces every column of an existing row. */
    upsert(rows: readonly BeatmapRow[]): Promise<void>;
    /** @returns Whether the row existed. */
    update(
        id: number,
        changes: Partial<Omit<BeatmapRow, "beatmapId">>,
    ): Promise<boolean>;
    delete(id: number): Promise<void>;
}
