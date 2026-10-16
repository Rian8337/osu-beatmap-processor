import { schema } from "@/database/schema";
import type { Database } from "@/database/types";
import { createTestDatabase as createDatabase } from "@/server/testing";
import { fileURLToPath } from "node:url";

export const migrationsFolder = fileURLToPath(
    new URL("../../drizzle", import.meta.url),
);

/**
 * An in-memory Postgres database for a test. Disposing closes it.
 */
export interface TestDatabase extends AsyncDisposable {
    readonly db: Database;
}

/**
 * Creates an in-memory Postgres (PGlite) database with every migration applied.
 */
export function createTestDatabase(): Promise<TestDatabase> {
    return createDatabase({ schema, migrationsFolder });
}
