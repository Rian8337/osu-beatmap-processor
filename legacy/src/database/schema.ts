import {
    BeatmapGenre,
    BeatmapLanguage,
    RankedStatus,
} from "@rian8337/osu-base";
import {
    doublePrecision,
    index,
    integer,
    pgTable,
    real,
    smallint,
    text,
    timestamp,
    varchar,
} from "drizzle-orm/pg-core";

/**
 * The beatmap table.
 */
export const beatmapTable = pgTable(
    "beatmap",
    {
        approved: smallint().$type<RankedStatus>().notNull(),
        submit_date: timestamp().notNull(),
        approved_date: timestamp(),
        last_update: timestamp().notNull(),
        artist: text().notNull(),
        beatmap_id: integer().primaryKey(),
        beatmapset_id: integer().notNull(),
        bpm: real().notNull(),
        creator: text().notNull(),
        creator_id: integer().notNull(),
        difficultyrating: doublePrecision(),
        diff_aim: doublePrecision(),
        diff_speed: doublePrecision(),
        diff_size: real().notNull(),
        diff_overall: real().notNull(),
        diff_approach: real().notNull(),
        diff_drain: real().notNull(),
        hit_length: integer().notNull(),
        source: text().notNull(),
        genre_id: integer().$type<BeatmapGenre>().notNull(),
        language_id: integer().$type<BeatmapLanguage>().notNull(),
        title: text().notNull(),
        total_length: integer().notNull(),
        version: text().notNull(),
        file_md5: varchar({ length: 32 }).notNull(),
        tags: text().notNull(),
        favourite_count: integer().notNull(),
        rating: real().notNull(),
        playcount: integer().notNull(),
        passcount: integer().notNull(),
        count_normal: integer().notNull(),
        count_slider: integer().notNull(),
        count_spinner: integer().notNull(),
        max_combo: integer(),
        storyboard: smallint().$type<boolean>().notNull(),
        video: smallint().$type<boolean>().notNull(),
        download_unavailable: smallint().$type<boolean>().notNull(),
        audio_unavailable: smallint().$type<boolean>().notNull(),
        packs: text(),
        last_checked: timestamp().notNull(),
    },
    (table) => [
        index("beatmapset_id_idx").on(table.beatmapset_id),
        index("beatmap_md5_idx").on(table.file_md5),
    ],
);

/**
 * The beatmapset population table.
 */
export const populateTable = pgTable("populate", {
    id: integer().primaryKey(),
});
