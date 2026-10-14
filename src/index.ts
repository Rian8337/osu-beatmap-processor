import "./polyfills";
import type { IKeyService } from "@/access/IKeyService";
import { createApp } from "@/app";
import { ConfigError, loadConfig } from "@/config/config";
import { assertMigrationHistory, BaselineError } from "@/database/baseline";
import { schema } from "@/database/schema";
import { registerDependencies } from "@/dependencies/register";
import { dependencyTokens } from "@/dependencies/tokens";
import { createOsuGatewayOptions } from "@/osu/createOsuGatewayOptions";
import {
    createShutdownHandler,
    DatabaseConnection,
    getContainer,
    GracefulServer,
    installLogPrefix,
    loadEnvironmentVariables,
} from "@/server";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";

// Long enough that a write still in progress is never touched.
const staleTemporaryFileAgeMs = 5 * 60_000;

async function main(): Promise<void> {
    // Kept for the process's whole lifetime, so never disposed. Installed first so every line carries the prefix.
    installLogPrefix("beatmap-service");
    loadEnvironmentVariables();

    const config = loadConfig(process.env);

    // Installed first so a SIGHUP during startup does not hit Node's default action (exit); it is ignored until
    // the keys have loaded.
    let keys: IKeyService | undefined;

    process.on("SIGHUP", () => {
        const loaded = keys;

        if (!loaded) {
            return;
        }

        void loaded.reload().then((reloaded) => {
            if (reloaded) {
                console.log(`Reloaded API keys: ${loaded.describeKeys()}`);
            }
        });
    });

    // Released in reverse order on shutdown: server, key reloading, then database.
    const resources = new AsyncDisposableStack();
    const container = getContainer();

    try {
        const database = resources.use(
            new DatabaseConnection(config.database, schema),
        );

        await database.db.execute(sql`select 1`);
        await assertMigrationHistory(database.db);
        await database.migrate(
            fileURLToPath(new URL("./drizzle", import.meta.url)),
        );

        registerDependencies(container, {
            config,
            db: database.db,
            osuGatewayOptions: createOsuGatewayOptions(config),
        });

        const keyService = container.resolve(dependencyTokens.keyService);

        await keyService.load();
        keys = keyService;
        console.log(`Loaded API keys: ${keyService.describeKeys()}`);
        resources.use(keyService.startReloading());

        // Leftovers of writes that a crash cut short. Logs its own failures, so it never stops startup.
        const removedTemporaryFiles = await container
            .resolve(dependencyTokens.beatmapFileStore)
            .removeStaleTemporaryFiles(staleTemporaryFileAgeMs);

        if (removedTemporaryFiles > 0) {
            console.log(
                `Removed ${removedTemporaryFiles.toString()} stale temporary beatmap file(s)`,
            );
        }

        const server = resources.use(new GracefulServer());
        const port = await server.listen(
            createApp(container, server.middleware),
            config.port,
        );

        console.log(`Listening on port ${port.toString()}`);
    } catch (e) {
        await resources.disposeAsync().catch((disposeError: unknown) => {
            console.error(
                "Failed to release resources after a startup failure:",
                disposeError,
            );
        });

        throw e;
    }

    const shutdown = createShutdownHandler({
        resources,
        // In-flight requests may wait for the osu! budget and then for osu! itself (10 s timeout).
        timeoutMs:
            Math.max(config.maxWaitMs.priority, config.maxWaitMs.bulk) + 15_000,
    });

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
}

main().catch((e: unknown) => {
    console.error(
        "Startup failed:",
        e instanceof ConfigError || e instanceof BaselineError ? e.message : e,
    );
    process.exit(1);
});
