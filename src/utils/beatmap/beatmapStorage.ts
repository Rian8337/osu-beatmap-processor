import { readFile, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { DatabaseBeatmap } from "../../database/schema/DatabaseBeatmap";
import { pool } from "../../database/databasePool";
import { DatabaseTables } from "../../database/DatabaseTables";
import { MapInfo, RankedStatus } from "@rian8337/osu-base";
import { convertMapInfoToDatabaseBeatmap } from "./beatmapConverter";
import { getBeatmapsetFromOsuAPI } from "./beatmapService";
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
 * @returns A `MapInfo` instance representing the beatmap.
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

export async function getBeatmapset(
    id: number,
): Promise<Map<number, DatabaseBeatmap> | null> {
    // Check existing cache first.
    let cache = beatmapSetIdCache.get(id) ?? null;

    // If still not found or invalid, request from osu! API.
    if (!cache) {
        const apiBeatmaps = await getBeatmapsetFromOsuAPI(id).then((v) =>
            v?.map((b) => MapInfo.from(b) as MapInfo<false>),
        );

        if (!apiBeatmaps) {
            return null;
        }

        cache = new Map<number, DatabaseBeatmap>();
        const databaseBeatmaps = apiBeatmaps.map((v) =>
            convertMapInfoToDatabaseBeatmap(v),
        );

        // Check the validity of per-beatmap cache.
        for (const beatmap of databaseBeatmaps) {
            const oldBeatmap =
                databaseBeatmapIdCache.get(beatmap.beatmap_id) ??
                (await getBeatmapFromDatabase(beatmap.beatmap_id));

            if (oldBeatmap && oldBeatmap.file_md5 !== beatmap.file_md5) {
                await invalidateBeatmapCache(oldBeatmap.file_md5, beatmap);
            }

            cache.set(beatmap.beatmap_id, beatmap);
            databaseBeatmapIdCache.set(beatmap.beatmap_id, beatmap);
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
    beatmapFile = await fetch(`https://osu.ppy.sh/osu/${id.toString()}`)
        .then((res) => {
            if (!res.ok) {
                return null;
            }

            return res.text();
        })
        .catch(() => null);

    if (!beatmapFile) {
        return null;
    }

    // Cache the beatmap file.
    await writeFile(beatmapFilePath, beatmapFile);

    return beatmapFile;
}

function getBeatmapFromDatabase(
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

async function insertBeatmapsToDatabase(...beatmaps: DatabaseBeatmap[]) {
    // Build query to perform a single transaction with the database.
    const firstBeatmap = beatmaps[0];
    const beatmapKeys = Object.keys(firstBeatmap);
    const insertValues: string[] = [];

    for (let i = 0; i < beatmaps.length; ++i) {
        const beatmap = beatmaps[i];

        insertValues.push(
            Object.values(beatmap)
                .map(
                    (_, j) => `$${(i * beatmapKeys.length + j + 1).toString()}`,
                )
                .join(","),
        );
    }

    await pool.query(
        `INSERT INTO ${DatabaseTables.beatmap} (${beatmapKeys.join(",")}) VALUES ${insertValues.map((v) => `(${v})`).join(",")};`,
        beatmaps.flatMap(
            (b) => Object.values(b) as (string | number | Date | boolean)[],
        ),
    );
}
