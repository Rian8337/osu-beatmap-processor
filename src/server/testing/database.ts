import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

/**
 * An in-memory Postgres database for a test. Disposing closes it.
 */
export interface TestDatabase<
    TSchema extends Record<string, unknown>,
> extends AsyncDisposable {
    readonly db: PgliteDatabase<TSchema>;
}

/**
 * Creates an in-memory Postgres (PGlite) database with all migrations in `migrationsFolder` applied.
 */
export async function createTestDatabase<
    TSchema extends Record<string, unknown>,
>(options: {
    schema: TSchema;
    migrationsFolder: string;
}): Promise<TestDatabase<TSchema>> {
    const client = new PGlite();
    const db = drizzle(client, {
        schema: options.schema,
        casing: "snake_case",
    });

    await migrate(db, { migrationsFolder: options.migrationsFolder });

    return { db, [Symbol.asyncDispose]: () => client[Symbol.asyncDispose]() };
}
