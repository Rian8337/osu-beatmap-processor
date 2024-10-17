import { pool } from "./database/databasePool";
import { getBeatmapsetFromOsuAPI } from "./utils/beatmap/beatmapService";
import { insertBeatmapsToDatabase } from "./utils/beatmap/beatmapStorage";
import { convertOsuAPIResponseToDatabaseBeatmap } from "./utils/beatmap/beatmapConverter";
import { RankedStatus, Utils } from "@rian8337/osu-base";
import { config } from "dotenv";

config();

const tableName = "populate";

interface Populate {
    readonly id: number;
}

pool.connect()
    .then(async () => {
        let id = await pool
            .query<Populate>(`SELECT * FROM ${tableName} WHERE id = 1;`)
            .then((res) => res.rows.at(0)?.id ?? null);

        if (id === null) {
            id = 1;

            await pool.query(`INSERT INTO ${tableName} (id) VALUES ($1);`, [
                id,
            ]);
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
        while (true) {
            await pool.query(`UPDATE ${tableName} SET id = $1;`, [id]);

            const beatmaps = await getBeatmapsetFromOsuAPI(id);

            await Utils.sleep(0.1);

            if (beatmaps === null || beatmaps.length === 0) {
                console.log(
                    `Beatmapset with ID ${(id++).toString()} not found.`,
                );
                continue;
            }

            console.log(`Beatmapset with ID ${(id++).toString()} found.`);

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
    })
    .catch((e: unknown) => {
        console.error(e);
    });
