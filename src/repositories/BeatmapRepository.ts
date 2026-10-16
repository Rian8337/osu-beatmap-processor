import { readOrUnavailable } from "@/database/errors";
import { beatmapTable } from "@/database/schema";
import type { BeatmapRow, Database } from "@/database/types";
import { dependencyTokens } from "@/dependencies/tokens";
import { Injectable } from "@/server";
import { asc, eq, inArray } from "drizzle-orm";
import { inject } from "tsyringe";
import type { IBeatmapRepository } from "./IBeatmapRepository";
import { upsertBeatmaps } from "./upsertBeatmaps";

@Injectable(dependencyTokens.beatmapRepository)
export class BeatmapRepository implements IBeatmapRepository {
    constructor(@inject(dependencyTokens.db) private readonly db: Database) {}

    findById(id: number): Promise<BeatmapRow | null> {
        return readOrUnavailable(async () => {
            const [row] = await this.db
                .select()
                .from(beatmapTable)
                .where(eq(beatmapTable.beatmapId, id))
                .limit(1);

            return row ?? null;
        });
    }

    findByHash(hash: string): Promise<BeatmapRow | null> {
        return readOrUnavailable(async () => {
            const [row] = await this.db
                .select()
                .from(beatmapTable)
                .where(eq(beatmapTable.fileMd5, hash))
                .limit(1);

            return row ?? null;
        });
    }

    findByIds(ids: readonly number[]): Promise<BeatmapRow[]> {
        if (ids.length === 0) {
            return Promise.resolve([]);
        }

        return readOrUnavailable(() =>
            this.db
                .select()
                .from(beatmapTable)
                .where(inArray(beatmapTable.beatmapId, [...ids])),
        );
    }

    findByBeatmapsetId(beatmapsetId: number): Promise<BeatmapRow[]> {
        return readOrUnavailable(() =>
            this.db
                .select()
                .from(beatmapTable)
                .where(eq(beatmapTable.beatmapsetId, beatmapsetId))
                .orderBy(asc(beatmapTable.beatmapId)),
        );
    }

    upsert(rows: readonly BeatmapRow[]): Promise<void> {
        return upsertBeatmaps(this.db, rows);
    }

    async update(
        id: number,
        changes: Partial<Omit<BeatmapRow, "beatmapId">>,
    ): Promise<boolean> {
        const updated = await this.db
            .update(beatmapTable)
            .set(changes)
            .where(eq(beatmapTable.beatmapId, id))
            .returning({ id: beatmapTable.beatmapId });

        return updated.length > 0;
    }

    async delete(id: number): Promise<void> {
        await this.db
            .delete(beatmapTable)
            .where(eq(beatmapTable.beatmapId, id));
    }
}
