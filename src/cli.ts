import "./polyfills";
import { consoleOutput, describeFailure } from "@/cli/output";
import { parseCli, runAction } from "@/cli/run";
import { loadConfig, loadDatabaseConfig } from "@/config/config";
import { assertMigrationHistory } from "@/database/baseline";
import { schema } from "@/database/schema";
import { createOsuGatewayOptions } from "@/osu/createOsuGatewayOptions";
import { OsuGateway } from "@/osu/OsuGateway";
import { DatabaseConnection, loadEnvironmentVariables } from "@/server";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

/**
 * `node dist/cli.mjs <command>`. The arguments are checked before any configuration is read or the database is
 * opened. Every command but `db-baseline` applies pending migrations first, so it works before the service has ever
 * started.
 */
async function main(): Promise<number> {
    const parsed = parseCli(process.argv.slice(2), consoleOutput);

    if (!parsed) {
        return 1;
    }

    loadEnvironmentVariables(true);

    await using database = new DatabaseConnection(
        loadDatabaseConfig(process.env),
        schema,
    );
    const migrationsFolder = fileURLToPath(
        new URL("./drizzle", import.meta.url),
    );

    if (parsed.requiresMigrations) {
        await assertMigrationHistory(database.db);
        await database.migrate(migrationsFolder);
    }

    // Awaited so the connection stays open until the command finishes.
    return await runAction(parsed.action, {
        output: consoleOutput,
        db: database.db,
        migrationsFolder,
        loadConfig: () => loadConfig(process.env),
        createOsuGateway: (config) =>
            new OsuGateway(createOsuGatewayOptions(config)),
        sleep: (ms) => sleep(ms),
    });
}

main().then(
    (code) => {
        process.exitCode = code;
    },
    (e: unknown) => {
        // Not the raw error: a database error carries the bound parameters, such as a key hash.
        console.error(describeFailure(e));
        process.exitCode = 1;
    },
);
