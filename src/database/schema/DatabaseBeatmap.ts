import { beatmapTable } from "../schema.js";

/**
 * Represents a beatmap in the database.
 */
export type DatabaseBeatmap = typeof beatmapTable.$inferSelect;
