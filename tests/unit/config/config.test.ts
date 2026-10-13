import { ConfigError, loadConfig, loadDatabaseConfig } from "@/config/config";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const required = {
    POSTGRES_HOSTNAME: "localhost",
    POSTGRES_DB_NAME: "beatmaps",
    POSTGRES_USERNAME: "service",
    OSU_API_KEY: "osu-key",
};

describe("loadConfig", () => {
    it("applies the defaults", () => {
        const config = loadConfig(required);

        expect(config).toEqual({
            port: 3000,
            database: {
                host: "localhost",
                port: 5432,
                name: "beatmaps",
                user: "service",
                password: "",
            },
            osu: {
                apiKey: "osu-key",
                apiBaseUrl: "https://osu.ppy.sh/api",
                fileBaseUrl: "https://osu.ppy.sh/osu",
            },
            builtInKeys: { priority: undefined, bulk: undefined },
            ratesPerMinute: { api: 55, file: 55, total: 55 },
            bulkShare: 0.5,
            maxWaitMs: { priority: 8000, bulk: 5000 },
            beatmapFileDirectory: resolve("beatmaps"),
            recheckMinutes: { qualified: 15, pending: 60, graveyard: 1440 },
            cacheSize: { beatmaps: 10_000, beatmapsets: 2000 },
            anonymousRateLimit: 30,
            keyReloadIntervalSeconds: 30,
            trustProxy: false,
        });
    });

    it("reads every variable", () => {
        const config = loadConfig({
            ...required,
            EXPRESS_PORT: "4000",
            POSTGRES_PORT: "5433",
            POSTGRES_PASSWORD: "secret",
            INTERNAL_SERVER_KEY: "internal",
            BULK_SERVER_KEY: "bulk",
            OSU_API_RATE_LIMIT: "40",
            OSU_FILE_RATE_LIMIT: "30",
            OSU_TOTAL_RATE_LIMIT: "50",
            BULK_SHARE: "0.25",
            PRIORITY_MAX_WAIT_MS: "100",
            BULK_MAX_WAIT_MS: "0",
            OSU_API_BASE_URL: "http://127.0.0.1:9/api/",
            OSU_FILE_BASE_URL: "http://127.0.0.1:9/osu",
            BEATMAP_FILE_DIRECTORY: "/srv/beatmaps",
            RECHECK_QUALIFIED_MINUTES: "1",
            RECHECK_PENDING_MINUTES: "2",
            RECHECK_GRAVEYARD_MINUTES: "3",
            BEATMAP_CACHE_SIZE: "5",
            BEATMAPSET_CACHE_SIZE: "6",
            ANON_RATE_LIMIT: "0",
            KEY_RELOAD_INTERVAL_SECONDS: "7",
            TRUST_PROXY: "loopback",
        });

        expect(config).toMatchObject({
            port: 4000,
            database: { port: 5433, password: "secret" },
            osu: { apiBaseUrl: "http://127.0.0.1:9/api" },
            builtInKeys: { priority: "internal", bulk: "bulk" },
            ratesPerMinute: { api: 40, file: 30, total: 50 },
            bulkShare: 0.25,
            maxWaitMs: { priority: 100, bulk: 0 },
            beatmapFileDirectory: "/srv/beatmaps",
            recheckMinutes: { qualified: 1, pending: 2, graveyard: 3 },
            cacheSize: { beatmaps: 5, beatmapsets: 6 },
            anonymousRateLimit: 0,
            keyReloadIntervalSeconds: 7,
            trustProxy: "loopback",
        });
    });

    it.each([
        ["true", true],
        ["false", false],
        ["2", 2],
        ["10.0.0.0/8", "10.0.0.0/8"],
    ])("parses TRUST_PROXY=%s", (value, expected) => {
        expect(loadConfig({ ...required, TRUST_PROXY: value }).trustProxy).toBe(
            expected,
        );
    });

    it("treats empty variables as unset", () => {
        expect(
            loadConfig({
                ...required,
                EXPRESS_PORT: "",
                INTERNAL_SERVER_KEY: "",
            }),
        ).toMatchObject({ port: 3000, builtInKeys: { priority: undefined } });
    });

    it("names every missing or invalid variable, never a value", () => {
        let error: unknown;

        try {
            loadConfig({
                OSU_API_KEY: "osu-key",
                BULK_SHARE: "2",
                OSU_API_RATE_LIMIT: "0",
                BEATMAP_CACHE_SIZE: "0",
            });
        } catch (e) {
            error = e;
        }

        expect(error).toBeInstanceOf(ConfigError);

        const message = (error as ConfigError).message;

        for (const name of [
            "POSTGRES_HOSTNAME",
            "POSTGRES_DB_NAME",
            "POSTGRES_USERNAME",
            "BULK_SHARE",
            "OSU_API_RATE_LIMIT",
            "BEATMAP_CACHE_SIZE",
        ]) {
            expect(message).toContain(name);
        }

        expect(message).not.toContain("osu-key");
    });

    it("rejects the same key for both lanes", () => {
        expect(() =>
            loadConfig({
                ...required,
                INTERNAL_SERVER_KEY: "same",
                BULK_SERVER_KEY: "same",
            }),
        ).toThrow(/BULK_SERVER_KEY must differ from INTERNAL_SERVER_KEY/);
    });
});

describe("loadDatabaseConfig", () => {
    it("reads only the database variables", () => {
        expect(
            loadDatabaseConfig({
                POSTGRES_HOSTNAME: "db",
                POSTGRES_DB_NAME: "beatmaps",
                POSTGRES_USERNAME: "service",
            }),
        ).toEqual({
            host: "db",
            port: 5432,
            name: "beatmaps",
            user: "service",
            password: "",
        });
    });
});
