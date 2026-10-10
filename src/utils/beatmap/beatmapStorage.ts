import { MapInfo } from "@rian8337/osu-base";
import { eq } from "drizzle-orm";
import { readFile, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { getConfig } from "../../config.js";
import { db } from "../../database/index.js";
import { beatmapTable } from "../../database/schema.js";
import { DatabaseBeatmap } from "../../database/schema/DatabaseBeatmap.js";
import { TimeConstrainedMap } from "../TimeConstrainedMap.js";
import { computeMD5 } from "../util.js";
import { convertMapInfoToDatabaseBeatmap } from "./beatmapConverter.js";
import type { Lane } from "../../osu/errors.js";
import { getOsuGateway } from "../../osu/index.js";
import { recheckBeatmap, recheckIntervalMs } from "./recheck.js";

const beatmapFileDirectory = join(process.cwd(), "beatmaps");

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
 * Gets a beatmap from the beatmap cache, or asks osu! if it is not available.
 *
 * @param lane The lane of the request.
 * @param beatmapIdOrHash The beatmap ID or MD5 hash of the beatmap.
 * @returns The beatmap, `null` if osu! does not have it.
 * @throws {OsuUnavailableError} If osu! could not be asked.
 */
export async function getBeatmap(
    lane: Lane,
    beatmapIdOrHash: number | string,
): Promise<DatabaseBeatmap | null> {
    const gateway = getOsuGateway();

    // Get cache from in-memory cache.
    let cache =
        (typeof beatmapIdOrHash === "number"
            ? databaseBeatmapIdCache.get(beatmapIdOrHash)
            : databaseBeatmapHashCache.get(beatmapIdOrHash)) ?? null;

    // Get cache from database.
    cache ??= await getBeatmapFromDatabase(beatmapIdOrHash);

    // If not found, ask osu!.
    if (!cache) {
        const apiBeatmap = await gateway.getBeatmap(lane, beatmapIdOrHash);

        if (!apiBeatmap) {
            return null;
        }

        cache = convertMapInfoToDatabaseBeatmap(MapInfo.from(apiBeatmap));

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

    // Re-check the status once the beatmap's status interval has passed, but only when osu!'s budget is idle:
    // a busy or failed re-check serves the cached beatmap unchanged.
    const recheckAfterMs = recheckIntervalMs(
        cache.approved,
        getConfig().recheckMinutes,
    );

    if (
        recheckAfterMs !== null &&
        cache.last_checked.getTime() < Date.now() - recheckAfterMs
    ) {
        const recheck = await recheckBeatmap(gateway, lane, cache.beatmap_id);

        if (recheck.kind === "gone") {
            return null;
        }

        if (recheck.kind === "fresh") {
            const apiBeatmap = MapInfo.from(recheck.beatmap);

            if (cache.file_md5 !== apiBeatmap.hash) {
                // Beatmap has been updated - invalidate cache completely.
                const oldHash = cache.file_md5;

                cache = convertMapInfoToDatabaseBeatmap(apiBeatmap);

                await invalidateBeatmapCache(oldHash, cache);
                await insertBeatmapsToDatabase(cache);
            } else {
                // Update the last checked date.
                cache.last_checked = new Date();
                cache.approved = apiBeatmap.approved;

                await db
                    .update(beatmapTable)
                    .set({
                        last_checked: cache.last_checked,
                        approved: cache.approved,
                    })
                    .where(eq(beatmapTable.beatmap_id, cache.beatmap_id))
                    .catch((e: unknown) => {
                        console.error("Error when updating beatmap status:", e);
                    });
            }
        }
    }

    // Cache the beatmap in memory.
    databaseBeatmapIdCache.set(cache.beatmap_id, cache);
    databaseBeatmapHashCache.set(cache.file_md5, cache);

    return cache;
}

/**
 * Gets a beatmapset from the beatmap cache, or asks osu! if it is not available.
 *
 * @param lane The lane of the request.
 * @param id The beatmapset ID.
 * @returns A `Map` instance representing the beatmapset.
 * @throws {OsuUnavailableError} If osu! could not be asked.
 */
export async function getBeatmapset(
    lane: Lane,
    id: number,
): Promise<Map<number, DatabaseBeatmap> | null> {
    // Check existing cache first.
    let cache = beatmapSetIdCache.get(id) ?? null;

    // If still not found or invalid, request from osu! API.
    if (!cache) {
        const apiBeatmaps = await getOsuGateway().getBeatmapset(lane, id);

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

        beatmapSetIdCache.set(id, cache);

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
 * @param lane The lane of the request.
 * @param id The ID of the beatmap.
 * @param hashComparison The MD5 hash of the beatmap file to compare with the existing one.
 * If this is provided and the hash matches, the existing file will be returned, else the file will be re-downloaded.
 * @returns The beatmap file, `null` if the beatmap file cannot be downloaded.
 * @throws {OsuUnavailableError} If osu! could not be asked.
 */
export async function getBeatmapFile(
    lane: Lane,
    id: number,
    hashComparison?: string,
): Promise<Buffer | null> {
    const beatmapFilePath = join(beatmapFileDirectory, `${id.toString()}.osu`);

    // Check existing file first.
    let beatmapFile: Buffer | null = null;

    try {
        beatmapFile = await readFile(beatmapFilePath);
    } catch {
        // File does not exist, will be downloaded later.
    }

    if (
        beatmapFile &&
        hashComparison !== undefined &&
        hashComparison !== computeMD5(beatmapFile)
    ) {
        // Hash is not the same - invalidate beatmap file.
        await invalidateBeatmapFile(id);

        beatmapFile = null;
    }

    if (beatmapFile) {
        return beatmapFile;
    }

    // If there is not, ask osu!.
    beatmapFile = await getOsuGateway().downloadFile(lane, id);

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

    return db
        .update(beatmapTable)
        .set({ max_combo: maxCombo })
        .where(eq(beatmapTable.beatmap_id, id))
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
    return db
        .select()
        .from(beatmapTable)
        .where(
            typeof beatmapIdOrHash === "number"
                ? eq(beatmapTable.beatmap_id, beatmapIdOrHash)
                : eq(beatmapTable.file_md5, beatmapIdOrHash),
        )
        .then((res) => res.at(0) ?? null)
        .catch((e: unknown) => {
            console.error("Error when getting beatmap from database:", e);

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
    await invalidateBeatmapFile(newCache.beatmap_id);

    await db
        .delete(beatmapTable)
        .where(eq(beatmapTable.beatmap_id, newCache.beatmap_id));
}

async function invalidateBeatmapFile(id: number) {
    await unlink(join(beatmapFileDirectory, `${id.toString()}.osu`)).catch(
        () => null,
    );
}

export async function insertBeatmapsToDatabase(...beatmaps: DatabaseBeatmap[]) {
    if (beatmaps.length === 0) {
        return;
    }

    await db
        .insert(beatmapTable)
        .values(beatmaps)
        .catch((e: unknown) => {
            console.error("Error when inserting beatmaps:", e);
        });
}
