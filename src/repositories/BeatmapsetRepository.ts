import { readOrUnavailable } from "@/database/errors";
import { beatmapsetTable, beatmapTable } from "@/database/schema";
import type { BeatmapRow, Database } from "@/database/types";
import { dependencyTokens } from "@/dependencies/tokens";
import { Injectable } from "@/server";
import { and, eq, notInArray } from "drizzle-orm";
import { inject } from "tsyringe";
import type { IBeatmapsetRepository } from "./IBeatmapsetRepository";
import { upsertBeatmaps } from "./upsertBeatmaps";

@Injectable(dependencyTokens.beatmapsetRepository)
export class BeatmapsetRepository implements IBeatmapsetRepository {
    constructor(@inject(dependencyTokens.db) private readonly db: Database) {}

    findLastChecked(beatmapsetId: number): Promise<Date | null> {
        return readOrUnavailable(async () => {
            const [set] = await this.db
                .select({ lastChecked: beatmapsetTable.lastChecked })
                .from(beatmapsetTable)
                .where(eq(beatmapsetTable.beatmapsetId, beatmapsetId))
                .limit(1);

            return set?.lastChecked ?? null;
        });
    }

    replaceBeatmapset(
        beatmapsetId: number,
        rows: readonly BeatmapRow[],
        checkedAt: Date,
    ): Promise<number[]> {
        return this.db.transaction(async (tx) => {
            const kept = rows.map((row) => row.beatmapId);
            const removed = await tx
                .delete(beatmapTable)
                .where(
                    and(
                        eq(beatmapTable.beatmapsetId, beatmapsetId),
                        kept.length > 0
                            ? notInArray(beatmapTable.beatmapId, kept)
                            : undefined,
                    ),
                )
                .returning({ id: beatmapTable.beatmapId });

            await upsertBeatmaps(tx, rows);
            await tx
                .insert(beatmapsetTable)
                .values({ beatmapsetId, lastChecked: checkedAt })
                .onConflictDoUpdate({
                    target: beatmapsetTable.beatmapsetId,
                    set: { lastChecked: checkedAt },
                });

            return removed.map(({ id }) => id).sort((a, b) => a - b);
        });
    }

    deleteBeatmapset(beatmapsetId: number): Promise<number[]> {
        return this.db.transaction(async (tx) => {
            const removed = await tx
                .delete(beatmapTable)
                .where(eq(beatmapTable.beatmapsetId, beatmapsetId))
                .returning({ id: beatmapTable.beatmapId });

            await tx
                .delete(beatmapsetTable)
                .where(eq(beatmapsetTable.beatmapsetId, beatmapsetId));

            return removed.map(({ id }) => id).sort((a, b) => a - b);
        });
    }

    async markIncomplete(beatmapsetId: number): Promise<void> {
        await this.db
            .delete(beatmapsetTable)
            .where(eq(beatmapsetTable.beatmapsetId, beatmapsetId));
    }
}
