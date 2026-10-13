import {
    assertMigrationHistory,
    BaselineError,
    baselineDatabase,
} from "@/database/baseline";
import { schema } from "@/database/schema";
import { extractRows, type Database } from "@/database/types";
import { PGlite } from "@electric-sql/pglite";
import { migrationsFolder } from "@test/utils/database";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// Each test starts one or two PGlite instances, which is slow under load.
vi.setConfig({ testTimeout: 30_000 });

const fixture = (path: string) =>
    readFile(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

const insertOldRow = `
INSERT INTO beatmap VALUES (
    1, '2007-10-06 01:46:31', '2007-10-06 01:46:31', '2007-10-06 01:46:31', 'Kenji Ninuma', 75, 1, 119.5, 'peppy', 2,
    2.5, 1.25, 1.125, 4, 6, 6, 6, 108, '', 2, 3, 'DISCO PRINCE', 142, 'Normal', '0123456789abcdef0123456789abcdef',
    'katamari', 100, 8.5, 1000, 500, 160, 30, 4, 314, false, true, false, false, 'S1 T44', '2025-01-01 00:00:00'
);`;

interface Opened {
    readonly client: PGlite;
    // Typed as PgliteDatabase because the pglite migrator does not accept the generic Database.
    readonly db: PgliteDatabase<typeof schema>;
}

const opened: PGlite[] = [];

function open(): Opened {
    const client = new PGlite();

    opened.push(client);

    return { client, db: drizzle(client, { schema, casing: "snake_case" }) };
}

/**
 * Describes columns and indexes, so two databases can be compared.
 */
async function describeSchema(db: Database) {
    const columns = extractRows(
        await db.execute(sql`
            select table_name, column_name, data_type, is_nullable, character_maximum_length
            from information_schema.columns where table_schema = 'public'
            order by table_name, column_name`),
    );
    const indexes = extractRows(
        await db.execute(sql`
            select indexname, indexdef from pg_indexes where schemaname = 'public' order by indexname`),
    );

    return { columns, indexes };
}

/**
 * A copy of the migrations folder that contains only the baseline.
 */
async function createBaselineOnlyFolder(): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), "baseline-"));

    await cp(migrationsFolder, folder, { recursive: true });

    const journalPath = join(folder, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
        entries: unknown[];
    };

    journal.entries = journal.entries.slice(0, 1);
    await writeFile(journalPath, JSON.stringify(journal));

    return folder;
}

afterEach(async () => {
    await Promise.all(opened.splice(0).map((client) => client.close()));
});

describe("migrations", () => {
    it("starts from exactly the production schema", async () => {
        const production = open();

        await production.client.exec(
            await fixture("fixtures/production-schema.sql"),
        );

        const migrated = open();
        const folder = await createBaselineOnlyFolder();

        try {
            await migrate(migrated.db, { migrationsFolder: folder });
        } finally {
            await rm(folder, { recursive: true, force: true });
        }

        expect(await describeSchema(migrated.db)).toEqual(
            await describeSchema(production.db),
        );
    });

    it("migrates a baselined production database without moving stored instants", async () => {
        const { client, db } = open();

        // A non-UTC session, so that a conversion without `AT TIME ZONE 'UTC'` would move the instants.
        await client.exec("set timezone = 'America/New_York'");
        await client.exec(await fixture("fixtures/production-schema.sql"));
        await client.exec(insertOldRow);
        await baselineDatabase(db, migrationsFolder);
        await migrate(db, { migrationsFolder });

        const [row] = await db.select().from(schema.beatmapTable);

        expect(row?.submitDate).toEqual(new Date("2007-10-06T01:46:31Z"));
        expect(row?.lastChecked).toEqual(new Date("2025-01-01T00:00:00Z"));
        expect(row?.video).toBe(true);

        const { indexes } = await describeSchema(db);

        expect(
            indexes.map((index) => (index as { indexname: string }).indexname),
        ).not.toContain("beatmap_id_idx");
        await expect(db.select().from(schema.apiKeysTable)).resolves.toEqual(
            [],
        );
        await expect(db.select().from(schema.beatmapsetTable)).resolves.toEqual(
            [],
        );
        await expect(db.select().from(schema.cliCursorTable)).resolves.toEqual(
            [],
        );
    });

    it("migrates an empty database from scratch", async () => {
        const { db } = open();

        await assertMigrationHistory(db);
        await migrate(db, { migrationsFolder });
        await assertMigrationHistory(db);
        await expect(db.select().from(schema.beatmapTable)).resolves.toEqual(
            [],
        );
    });

    it("refuses to start on a pre-rewrite database without a baseline", async () => {
        const { client, db } = open();

        await client.exec(await fixture("fixtures/production-schema.sql"));

        await expect(assertMigrationHistory(db)).rejects.toThrow(
            /run `pnpm db:baseline` once first/,
        );
        await baselineDatabase(db, migrationsFolder);
        await expect(assertMigrationHistory(db)).resolves.toBeUndefined();
    });

    it("baselines only a pre-rewrite database without history", async () => {
        const empty = open();

        await expect(
            baselineDatabase(empty.db, migrationsFolder),
        ).rejects.toBeInstanceOf(BaselineError);

        const production = open();

        await production.client.exec(
            await fixture("fixtures/production-schema.sql"),
        );
        await baselineDatabase(production.db, migrationsFolder);
        await expect(
            baselineDatabase(production.db, migrationsFolder),
        ).rejects.toThrow(/already recorded/);
    });

    it("rolls back to a schema the old build reads, and migrates forward again", async () => {
        const { client, db } = open();

        await client.exec(await fixture("fixtures/production-schema.sql"));
        await client.exec(insertOldRow);
        await baselineDatabase(db, migrationsFolder);
        await migrate(db, { migrationsFolder });
        await client.exec(
            await fixture("../docs/rollback/0001_rewrite.down.sql"),
        );

        const production = open();

        await production.client.exec(
            await fixture("fixtures/production-schema.sql"),
        );
        expect(await describeSchema(db)).toEqual(
            await describeSchema(production.db),
        );

        const [stored] = extractRows<{ submit_date: string }>(
            await db.execute(sql`select submit_date::text from beatmap`),
        );

        expect(stored?.submit_date).toBe("2007-10-06 01:46:31");

        await migrate(db, { migrationsFolder });

        const [row] = await db.select().from(schema.beatmapTable);

        expect(row?.submitDate).toEqual(new Date("2007-10-06T01:46:31Z"));
    });
});
