import { DatabaseUnavailableError } from "@/database/errors";
import type { BeatmapRow } from "@/database/types";
import type { IBeatmapRepository } from "@/repositories/IBeatmapRepository";

/**
 * The beatmap table in memory.
 */
export class FakeBeatmapRepository implements IBeatmapRepository {
    readonly rows = new Map<number, BeatmapRow>();
    shouldFailReads = false;
    shouldFailWrites = false;
    readCount = 0;

    constructor(...initial: BeatmapRow[]) {
        for (const row of initial) {
            this.rows.set(row.beatmapId, row);
        }
    }

    async findById(id: number): Promise<BeatmapRow | null> {
        this.simulateRead();

        return this.rows.get(id) ?? null;
    }

    async findByHash(hash: string): Promise<BeatmapRow | null> {
        this.simulateRead();

        return [...this.rows.values()].find((r) => r.fileMd5 === hash) ?? null;
    }

    async findByIds(ids: readonly number[]): Promise<BeatmapRow[]> {
        this.simulateRead();

        return ids.flatMap((id) => this.rows.get(id) ?? []);
    }

    async findByBeatmapsetId(beatmapsetId: number): Promise<BeatmapRow[]> {
        this.simulateRead();

        return [...this.rows.values()]
            .filter((r) => r.beatmapsetId === beatmapsetId)
            .sort((a, b) => a.beatmapId - b.beatmapId);
    }

    async upsert(rows: readonly BeatmapRow[]): Promise<void> {
        this.simulateWrite();

        for (const row of rows) {
            this.rows.set(row.beatmapId, { ...row });
        }
    }

    async update(
        id: number,
        changes: Partial<Omit<BeatmapRow, "beatmapId">>,
    ): Promise<boolean> {
        this.simulateWrite();

        const row = this.rows.get(id);

        if (!row) {
            return false;
        }

        this.rows.set(id, { ...row, ...changes });

        return true;
    }

    async delete(id: number): Promise<void> {
        this.simulateWrite();
        this.rows.delete(id);
    }

    /** Counts a database read, and fails it as the real repository would when `shouldFailReads` is set. */
    simulateRead(): void {
        this.readCount++;

        if (this.shouldFailReads) {
            throw new DatabaseUnavailableError(new Error("database down"));
        }
    }

    /** Fails a database write when `shouldFailWrites` is set. */
    simulateWrite(): void {
        if (this.shouldFailWrites) {
            throw new Error("database write failed");
        }
    }
}
