import { runCli } from "@/cli/run";
import { schema } from "@/database/schema";
import { PGlite } from "@electric-sql/pglite";
import { createCliDependencies } from "@test/utils/cli";
import { migrationsFolder } from "@test/utils/database";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("db-baseline", () => {
    it("records the baseline on a pre-rewrite database, once", async () => {
        const client = new PGlite();

        try {
            await client.exec(
                await readFile(
                    fileURLToPath(
                        new URL(
                            "../../fixtures/production-schema.sql",
                            import.meta.url,
                        ),
                    ),
                    "utf8",
                ),
            );

            const db = drizzle(client, { schema, casing: "snake_case" });
            const deps = createCliDependencies(db);

            expect(await runCli(["db-baseline"], deps)).toBe(0);
            await migrate(db, { migrationsFolder });
            await expect(
                db.select().from(schema.beatmapsetTable),
            ).resolves.toEqual([]);

            expect(await runCli(["db-baseline"], deps)).toBe(1);
            expect(deps.output.errors.join("\n")).toMatch(/already recorded/);
        } finally {
            await client.close();
        }
    });
});
