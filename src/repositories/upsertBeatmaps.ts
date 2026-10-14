import { beatmapTable } from "@/database/schema";
import type { BeatmapRow, Database } from "@/database/types";
import { getTableColumns, sql } from "drizzle-orm";

const replaceEveryColumn = Object.fromEntries(
    Object.entries(getTableColumns(beatmapTable))
        .filter(([, column]) => !column.primary)
        .map(([key, column]) => [key, sql.raw(`excluded."${column.name}"`)]),
);

/**
 * Inserts beatmaps, replacing every column of existing rows. Concurrent requests for the same uncached beatmap race
 * to insert it, so the latest data wins.
 *
 * @param db The database or a transaction.
 */
export async function upsertBeatmaps(
    db: Pick<Database, "insert">,
    rows: readonly BeatmapRow[],
): Promise<void> {
    if (rows.length === 0) {
        return;
    }

    await db
        .insert(beatmapTable)
        .values([...rows])
        .onConflictDoUpdate({
            target: beatmapTable.beatmapId,
            set: replaceEveryColumn,
        });
}
