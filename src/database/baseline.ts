import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { extractRows, type Database } from "./types";

/**
 * The database is not in the state a baseline needs, or needs a baseline first. The message says what to do.
 */
export class BaselineError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BaselineError";
    }
}

async function hasBeatmapTable(db: Database): Promise<boolean> {
    const [row] = extractRows<{ present: boolean }>(
        await db.execute(
            sql`select to_regclass('public.beatmap') is not null as present`,
        ),
    );

    return row?.present ?? false;
}

async function countRecordedMigrations(db: Database): Promise<number> {
    const [table] = extractRows<{ present: boolean }>(
        await db.execute(
            sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
        ),
    );

    if (!table?.present) {
        return 0;
    }

    const [row] = extractRows<{ count: number }>(
        await db.execute(
            sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
        ),
    );

    return row?.count ?? 0;
}

/**
 * Records the first migration (`0000_baseline`, the pre-rewrite schema) as applied without running it, for a database
 * that has the pre-rewrite `beatmap` table but no migration history.
 *
 * @throws {BaselineError} If there is no `beatmap` table, or migrations are already recorded.
 */
export async function baselineDatabase(
    db: Database,
    migrationsFolder: string,
): Promise<void> {
    const [baseline] = readMigrationFiles({ migrationsFolder });

    if (!baseline) {
        throw new Error(`No migrations in ${migrationsFolder}`);
    }

    if ((await countRecordedMigrations(db)) > 0) {
        throw new BaselineError(
            "Migrations are already recorded; this database needs no baseline",
        );
    }

    if (!(await hasBeatmapTable(db))) {
        throw new BaselineError(
            "There is no beatmap table to baseline; a new database needs no baseline (migrations create it)",
        );
    }

    // The same table Drizzle's migrator creates and reads.
    await db.execute(sql`create schema if not exists drizzle`);
    await db.execute(
        sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`,
    );
    await db.execute(
        sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${baseline.hash}, ${baseline.folderMillis})`,
    );
}

/**
 * Stops a start against a pre-rewrite database that was never baselined: migrating it would try to create the
 * `beatmap` table that already exists.
 *
 * @throws {BaselineError} If the `beatmap` table exists but no migration is recorded.
 */
export async function assertMigrationHistory(db: Database): Promise<void> {
    if (
        (await countRecordedMigrations(db)) === 0 &&
        (await hasBeatmapTable(db))
    ) {
        throw new BaselineError(
            "The database has a beatmap table but no migration history; run `pnpm db:baseline` once first",
        );
    }
}
