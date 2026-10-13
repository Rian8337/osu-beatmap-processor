import type {
    BeatmapGenre,
    BeatmapLanguage,
    RankedStatus,
} from "@rian8337/osu-base";
import { sql } from "drizzle-orm";
import {
    boolean,
    char,
    check,
    doublePrecision,
    index,
    integer,
    pgTable,
    real,
    serial,
    smallint,
    text,
    timestamp,
    varchar,
} from "drizzle-orm/pg-core";

/**
 * A `timestamptz` column read as a `Date`.
 */
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Cached beatmaps, one row per osu!standard beatmap. Column names are those of the pre-rewrite table.
 */
export const beatmapTable = pgTable(
    "beatmap",
    {
        approved: smallint("approved").$type<RankedStatus>().notNull(),
        submitDate: timestamptz("submit_date").notNull(),
        approvedDate: timestamptz("approved_date"),
        lastUpdate: timestamptz("last_update").notNull(),
        artist: text("artist").notNull(),
        beatmapId: integer("beatmap_id").primaryKey(),
        beatmapsetId: integer("beatmapset_id").notNull(),
        bpm: real("bpm").notNull(),
        creator: text("creator").notNull(),
        creatorId: integer("creator_id").notNull(),
        difficultyRating: doublePrecision("difficultyrating"),
        diffAim: doublePrecision("diff_aim"),
        diffSpeed: doublePrecision("diff_speed"),
        diffSize: real("diff_size").notNull(),
        diffOverall: real("diff_overall").notNull(),
        diffApproach: real("diff_approach").notNull(),
        diffDrain: real("diff_drain").notNull(),
        hitLength: integer("hit_length").notNull(),
        source: text("source").notNull(),
        genreId: integer("genre_id").$type<BeatmapGenre>().notNull(),
        languageId: integer("language_id").$type<BeatmapLanguage>().notNull(),
        title: text("title").notNull(),
        totalLength: integer("total_length").notNull(),
        version: text("version").notNull(),
        fileMd5: varchar("file_md5", { length: 32 }).notNull(),
        tags: text("tags").notNull(),
        favouriteCount: integer("favourite_count").notNull(),
        rating: real("rating").notNull(),
        playcount: integer("playcount").notNull(),
        passcount: integer("passcount").notNull(),
        countNormal: integer("count_normal").notNull(),
        countSlider: integer("count_slider").notNull(),
        countSpinner: integer("count_spinner").notNull(),
        maxCombo: integer("max_combo"),
        storyboard: boolean("storyboard").notNull(),
        video: boolean("video").notNull(),
        downloadUnavailable: boolean("download_unavailable").notNull(),
        audioUnavailable: boolean("audio_unavailable").notNull(),
        packs: text("packs"),
        lastChecked: timestamptz("last_checked").notNull(),
    },
    (table) => [
        index("beatmapset_id_idx").on(table.beatmapsetId),
        index("beatmap_md5_idx").on(table.fileMd5),
    ],
);

/**
 * Beatmapsets whose every osu!standard beatmap was stored at `lastChecked`. Rows alone cannot tell whether a set is
 * complete, because a single-beatmap lookup stores one difficulty.
 */
export const beatmapsetTable = pgTable("beatmapset", {
    beatmapsetId: integer("beatmapset_id").primaryKey(),
    lastChecked: timestamptz("last_checked").notNull(),
});

/**
 * Where each CLI walk resumes.
 */
export const cliCursorTable = pgTable("cli_cursor", {
    command: text("command").primaryKey(),
    cursor: timestamptz("cursor").notNull(),
});

/**
 * API keys. Only the SHA-256 hash of a key is stored.
 */
export const apiKeysTable = pgTable(
    "api_keys",
    {
        id: serial("id").primaryKey(),
        name: text("name").notNull().unique("api_keys_name_unique"),
        keyHash: char("key_hash", { length: 64 })
            .notNull()
            .unique("api_keys_key_hash_unique"),
        lane: text("lane").$type<"priority" | "bulk">().notNull(),
        rateLimitPerMinute: integer("rate_limit_per_minute"),
        createdAt: timestamptz("created_at").notNull().defaultNow(),
        revokedAt: timestamptz("revoked_at"),
    },
    (table) => [
        check(
            "api_keys_lane_check",
            sql`${table.lane} in ('priority', 'bulk')`,
        ),
    ],
);

export const schema = {
    beatmapTable,
    beatmapsetTable,
    cliCursorTable,
    apiKeysTable,
};
