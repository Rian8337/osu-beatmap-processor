import "dotenv/config";
import { getBeatmapsetFromOsuAPI } from "./utils/beatmap/beatmapService";
import { insertBeatmapsToDatabase } from "./utils/beatmap/beatmapStorage";
import { convertOsuAPIResponseToDatabaseBeatmap } from "./utils/beatmap/beatmapConverter";
import { RankedStatus, Utils } from "@rian8337/osu-base";
import { db } from "./database";
import { populateTable } from "./database/schema";

void (async () => {
    let id = await db
        .select()
        .from(populateTable)
        .limit(1)
        .then((res) => res.at(0)?.id ?? null);

    if (id === null) {
        id = 1;

        await db.insert(populateTable).values({ id });
    }

    while (id <= 5000000) {
        await db.update(populateTable).set({ id });

        const beatmaps = await getBeatmapsetFromOsuAPI(id);

        await Utils.sleep(0.1);

        if (beatmaps === null || beatmaps.length === 0) {
            console.log("Beatmapset with ID", id++, "not found.");
            continue;
        }

        console.log("Beatmapset with ID", id++, "found.");

        await insertBeatmapsToDatabase(
            ...beatmaps
                .map(convertOsuAPIResponseToDatabaseBeatmap)
                .filter(
                    (v) =>
                        v.approved === RankedStatus.ranked ||
                        v.approved === RankedStatus.approved,
                ),
        );
    }
})();
