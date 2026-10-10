import "dotenv/config";
import { RankedStatus, Utils } from "@rian8337/osu-base";
import { db } from "./database/index.js";
import { populateTable } from "./database/schema.js";
import { getOsuGateway, OsuUnavailableError } from "./osu/index.js";
import { convertOsuAPIResponseToDatabaseBeatmap } from "./utils/beatmap/beatmapConverter.js";
import { insertBeatmapsToDatabase } from "./utils/beatmap/beatmapStorage.js";

// Walks every beatmapset ID through osu! on the bulk lane. The rate limiter paces it, and it waits out
// refusals and 429 pauses instead of skipping IDs.
void (async () => {
    const gateway = getOsuGateway();
    let id = await db
        .select()
        .from(populateTable)
        .limit(1)
        .then((res) => res.at(0)?.id ?? null);

    if (id === null) {
        id = 1;

        await db.insert(populateTable).values({ id });
    }

    while (id <= 2500000) {
        await db.update(populateTable).set({ id });

        let beatmaps;

        try {
            beatmaps = await gateway.getBeatmapset("bulk", id);
        } catch (e) {
            if (e instanceof OsuUnavailableError) {
                await Utils.sleep(e.retryAfterSeconds);
                continue;
            }

            throw e;
        }

        if (beatmaps === null) {
            console.log("Beatmapset with ID", id++, "not found.");
            continue;
        }

        console.log("Beatmapset with ID", id++, "found.");

        await insertBeatmapsToDatabase(
            ...beatmaps
                .map(convertOsuAPIResponseToDatabaseBeatmap)
                .filter(
                    (v) =>
                        v.approved === RankedStatus.Ranked ||
                        v.approved === RankedStatus.Approved,
                ),
        );
    }
})();
