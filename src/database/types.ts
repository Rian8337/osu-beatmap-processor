import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { beatmapTable, schema } from "./schema";

/**
 * A Drizzle database with this service's schema. Both node-postgres (production) and PGlite (tests) databases are
 * assignable to it.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * A cached beatmap.
 */
export type BeatmapRow = typeof beatmapTable.$inferSelect;

/**
 * The rows of a raw `db.execute` result. node-postgres and PGlite both return `{ rows }`.
 */
export function extractRows<T>(result: unknown): T[] {
    return (result as { rows: T[] }).rows;
}
