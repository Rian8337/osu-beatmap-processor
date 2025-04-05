import {
    BeatmapGenre,
    BeatmapLanguage,
    RankedStatus,
} from "@rian8337/osu-base";
import { beatmapTable } from "../schema";

/**
 * Represents a beatmap in the database.
 */
export type DatabaseBeatmap = typeof beatmapTable.$inferSelect;
