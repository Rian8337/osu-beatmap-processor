import type { Config } from "@/config/config";

export const testKeys = {
    priority: "test-priority-key-0123456789",
    bulk: "test-bulk-key-0123456789",
};

/**
 * Settings for tests: fast osu! limits, short waits, a small anonymous limit. Tests that touch files or osu! override
 * `beatmapFileDirectory` and `osu`.
 */
export const testConfig: Config = {
    port: 0,
    database: {
        host: "localhost",
        port: 5432,
        name: "test",
        user: "test",
        password: "",
    },
    osu: {
        apiKey: "test-osu-key",
        apiBaseUrl: "http://127.0.0.1:9/api",
        fileBaseUrl: "http://127.0.0.1:9/osu",
    },
    builtInKeys: testKeys,
    ratesPerMinute: { api: 60_000, file: 60_000, total: 60_000 },
    bulkShare: 1,
    maxWaitMs: { priority: 60_000, bulk: 60_000 },
    beatmapFileDirectory: "/nonexistent/beatmaps",
    recheckMinutes: { qualified: 15, pending: 60, graveyard: 1440 },
    cacheSize: { beatmaps: 100, beatmapsets: 100 },
    anonymousRateLimit: 3,
    keyReloadIntervalSeconds: 30,
    trustProxy: false,
};
