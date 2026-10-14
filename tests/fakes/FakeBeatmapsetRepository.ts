import type { BeatmapRow } from "@/database/types";
import type { IBeatmapsetRepository } from "@/repositories/IBeatmapsetRepository";
import type { FakeBeatmapRepository } from "./FakeBeatmapRepository";

/**
 * Set completeness in memory, over a {@link FakeBeatmapRepository}'s rows.
 */
export class FakeBeatmapsetRepository implements IBeatmapsetRepository {
    readonly lastCheckedById = new Map<number, Date>();

    constructor(private readonly beatmapRepository: FakeBeatmapRepository) {}

    async findLastChecked(beatmapsetId: number): Promise<Date | null> {
        this.beatmapRepository.simulateRead();

        return this.lastCheckedById.get(beatmapsetId) ?? null;
    }

    async replaceBeatmapset(
        beatmapsetId: number,
        rows: readonly BeatmapRow[],
        checkedAt: Date,
    ): Promise<number[]> {
        this.beatmapRepository.simulateWrite();

        const kept = new Set(rows.map((r) => r.beatmapId));
        const removed = [...this.beatmapRepository.rows.values()]
            .filter(
                (r) =>
                    r.beatmapsetId === beatmapsetId && !kept.has(r.beatmapId),
            )
            .map((r) => r.beatmapId)
            .sort((a, b) => a - b);

        for (const id of removed) {
            this.beatmapRepository.rows.delete(id);
        }

        for (const row of rows) {
            this.beatmapRepository.rows.set(row.beatmapId, { ...row });
        }

        this.lastCheckedById.set(beatmapsetId, checkedAt);

        return removed;
    }

    async deleteBeatmapset(beatmapsetId: number): Promise<number[]> {
        this.beatmapRepository.simulateWrite();

        const removed = [...this.beatmapRepository.rows.values()]
            .filter((r) => r.beatmapsetId === beatmapsetId)
            .map((r) => r.beatmapId)
            .sort((a, b) => a - b);

        for (const id of removed) {
            this.beatmapRepository.rows.delete(id);
        }

        this.lastCheckedById.delete(beatmapsetId);

        return removed;
    }

    async markIncomplete(beatmapsetId: number): Promise<void> {
        this.beatmapRepository.simulateWrite();
        this.lastCheckedById.delete(beatmapsetId);
    }
}
