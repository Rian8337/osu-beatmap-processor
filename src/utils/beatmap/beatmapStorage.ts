import { readFile, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { DatabaseBeatmap } from "../../database/schema/DatabaseBeatmap";
import { pool } from "../../database/databasePool";
import { DatabaseTables } from "../../database/DatabaseTables";
import { MapInfo, RankedStatus } from "@rian8337/osu-base";
import { convertMapInfoToDatabaseBeatmap } from "./beatmapConverter";
import * as beatmapService from "./beatmapService";
import { TimeConstrainedMap } from "../TimeConstrainedMap";
import { homedir } from "os";

const beatmapFileDirectory = join(
    homedir(),
    "..",
    "..",
    "data",
    "osudroid",
    "beatmaps",
);

const databaseBeatmapIdCache = new TimeConstrainedMap<number, DatabaseBeatmap>(
    900,
);

const databaseBeatmapHashCache = new TimeConstrainedMap<
    string,
    DatabaseBeatmap
>(900);

const beatmapSetIdCache = new TimeConstrainedMap<
    number,
    Map<number, DatabaseBeatmap>
>(900);

/**
 * Gets a beatmap from the beatmap cache, or requests the osu! API it if it's not available.
 *
 * @param beatmapIdOrHash The beatmap ID or MD5 hash of the beatmap.
 * @param options Options for the retrieval of the beatmap.
 * @returns The beatmap, `null` if the beatmap is not found.
 */
export async function getBeatmap(
    beatmapIdOrHash: number | string,
): Promise<DatabaseBeatmap | null> {
    // Get cache from database.
    let cache = await getBeatmapFromDatabase(beatmapIdOrHash);

    // If not found, request from osu! API.
    if (!cache) {
        const apiBeatmap = await MapInfo.getInformation(beatmapIdOrHash, false);

        if (!apiBeatmap) {
            return null;
        }

        cache = convertMapInfoToDatabaseBeatmap(apiBeatmap);

        // When retrieving with beatmap hash, the beatmap may be invalid when the new hash is retrieved.
        // In that case, invalidate the cache.
        if (typeof beatmapIdOrHash === "string") {
            if (databaseBeatmapIdCache.has(cache.beatmap_id)) {
                await invalidateBeatmapCache(beatmapIdOrHash, cache);
            } else {
                // Check if the old beatmap cache is in the database.
                const oldCache = await getBeatmapFromDatabase(cache.beatmap_id);

                if (oldCache && oldCache.file_md5 !== cache.file_md5) {
                    await invalidateBeatmapCache(beatmapIdOrHash, cache);
                }
            }
        }

        // Insert the cache to the database.
        await insertBeatmapsToDatabase(cache);
    }

    // For unranked beatmaps, check the status if 15 minutes have passed since the last check.
    if (
        cache.approved !== RankedStatus.ranked &&
        cache.approved !== RankedStatus.approved &&
        cache.last_checked < new Date(Date.now() - 900000)
    ) {
        const apiBeatmap = await MapInfo.getInformation(
            cache.beatmap_id,
            false,
        );

        if (!apiBeatmap) {
            // Cannot check status - invalidate for now, but do not delete existing cache.
            return null;
        }

        if (cache.file_md5 !== apiBeatmap.hash) {
            // Beatmap has been updated - invalidate cache completely.
            const oldHash = cache.file_md5;

            cache = convertMapInfoToDatabaseBeatmap(apiBeatmap);

            await invalidateBeatmapCache(oldHash, cache);
            await insertBeatmapsToDatabase(cache);
        } else {
            // Update the last checked date.
            cache.last_checked = new Date();

            if (apiBeatmap.approved !== cache.approved) {
                cache.approved = apiBeatmap.approved;

                await pool.query(
                    `UPDATE ${DatabaseTables.beatmap} SET last_checked = $1, approved = $2 WHERE id = $3;`,
                    [cache.last_checked, cache.approved, cache.beatmap_id],
                );
            } else {
                await pool.query(
                    `UPDATE ${DatabaseTables.beatmap} SET last_checked = $1 WHERE id = $2;`,
                    [cache.last_checked, cache.beatmap_id],
                );
            }
        }
    }

    // Cache the beatmap in memory.
    databaseBeatmapIdCache.set(cache.beatmap_id, cache);
    databaseBeatmapHashCache.set(cache.file_md5, cache);

    return cache;
}

/**
 * Gets a beatmapset from the beatmap cache, or requests the osu! API it if it's not available.
 *
 * @param id The beatmapset ID.
 * @returns A `Map` instance representing the beatmapset.
 */
export async function getBeatmapset(
    id: number,
): Promise<Map<number, DatabaseBeatmap> | null> {
    // Check existing cache first.
    let cache = beatmapSetIdCache.get(id) ?? null;

    // If still not found or invalid, request from osu! API.
    if (!cache) {
        const apiBeatmaps = await beatmapService.getBeatmapsetFromOsuAPI(id);

        if (!apiBeatmaps) {
            return null;
        }

        cache = new Map<number, DatabaseBeatmap>();

        for (const apiBeatmap of apiBeatmaps) {
            if (apiBeatmap.mode !== "0") {
                continue;
            }

            const databaseBeatmap = convertMapInfoToDatabaseBeatmap(
                MapInfo.from(apiBeatmap),
            );

            cache.set(databaseBeatmap.beatmap_id, databaseBeatmap);
        }

        // Check the validity of per-beatmap cache.
        for (const beatmap of cache.values()) {
            const oldBeatmap =
                databaseBeatmapIdCache.get(beatmap.beatmap_id) ??
                (await getBeatmapFromDatabase(beatmap.beatmap_id));

            if (oldBeatmap && oldBeatmap.file_md5 !== beatmap.file_md5) {
                await invalidateBeatmapCache(oldBeatmap.file_md5, beatmap);
            }

            databaseBeatmapIdCache.set(beatmap.beatmap_id, beatmap);
            databaseBeatmapHashCache.set(beatmap.file_md5, beatmap);
        }
    }

    return cache;
}

/**
 * Gets the beatmap file of a beatmap.
 *
 * @param id The ID of the beatmap.
 * @returns The beatmap file, `null` if the beatmap file cannot be downloaded.
 */
export async function getBeatmapFile(id: number): Promise<string | null> {
    const beatmapFilePath = join(beatmapFileDirectory, `${id.toString()}.osu`);

    // Check existing file first.
    let beatmapFile = await readFile(beatmapFilePath, "utf-8").catch(
        () => null,
    );

    if (beatmapFile) {
        return beatmapFile;
    }

    // If there is not, request from osu! API.
    beatmapFile = await beatmapService.getBeatmapFile(id);

    if (!beatmapFile) {
        return null;
    }

    // Cache the beatmap file.
    await writeFile(beatmapFilePath, beatmapFile);

    return beatmapFile;
}

/**
 * Updates the maximum combo of a beatmap.
 *
 * This is used in place of the osu! API for setting the maximum combo
 * of a beatmap in case the API returns `null`.
 *
 * @param id The ID of the beatmap.
 * @param maxCombo The maximum combo of the beatmap.
 * @returns
 */
export async function updateBeatmapMaxCombo(
    id: number,
    maxCombo: number,
): Promise<boolean> {
    const cache = databaseBeatmapIdCache.get(id);

    if (cache) {
        cache.max_combo = maxCombo;
    }

    return pool
        .query(
            `UPDATE ${DatabaseTables.beatmap} SET max_combo = $1 WHERE id = $2;`,
            [maxCombo, id],
        )
        .then(() => true)
        .catch((e: unknown) => {
            console.error("Error when updating beatmap maximum combo:", e);

            return false;
        });
}

/**
 * Obtains a beatmap from the database.
 *
 * @param beatmapIdOrHash The ID or MD5 hash of the beatmap.
 * @returns The beatmap, `null` if the beatmap is not found.
 */
export function getBeatmapFromDatabase(
    beatmapIdOrHash: number | string,
): Promise<DatabaseBeatmap | null> {
    return pool
        .query<DatabaseBeatmap>(
            `SELECT * FROM ${DatabaseTables.beatmap} WHERE ${
                typeof beatmapIdOrHash === "number" ? "beatmap_id" : "file_md5"
            } = $1;`,
            [beatmapIdOrHash],
        )
        .then((res) => res.rows.at(0) ?? null)
        .catch((e: unknown) => {
            console.error(e);

            return null;
        });
}

async function invalidateBeatmapCache(
    oldHash: string,
    newCache: DatabaseBeatmap,
) {
    databaseBeatmapIdCache.delete(newCache.beatmap_id);
    databaseBeatmapHashCache.delete(oldHash);

    // Delete the beatmap file.
    await unlink(
        join("beatmaps", `${newCache.beatmap_id.toString()}.osu`),
    ).catch(() => null);

    // Delete the cache from the database.
    await pool.query<DatabaseBeatmap>(
        `DELETE FROM ${DatabaseTables.beatmap} WHERE id = $1;`,
        [newCache.beatmap_id],
    );
}

export async function insertBeatmapsToDatabase(...beatmaps: DatabaseBeatmap[]) {
    if (beatmaps.length === 0) {
        return;
    }

    // Build query to perform a single transaction with the database.
    const firstBeatmap = beatmaps[0];
    const beatmapKeys = Object.keys(firstBeatmap);

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        for (const beatmap of beatmaps) {
            await client.query(
                `INSERT INTO ${DatabaseTables.beatmap} (${beatmapKeys.join(",")}) VALUES (${beatmapKeys
                    .map((_, i) => `$${(i + 1).toString()}`)
                    .join(",")});`,
                Object.values(beatmap),
            );
        }

        await client.query("COMMIT");
    } catch (e: unknown) {
        console.error(e);
        await client.query("ROLLBACK");
    } finally {
        client.release();
    }
}
