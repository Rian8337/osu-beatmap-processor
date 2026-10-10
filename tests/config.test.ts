import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
    it("applies defaults", () => {
        expect(loadConfig({ OSU_API_KEY: "osu-key" })).toEqual({
            osuApiKey: "osu-key",
            internalServerKey: undefined,
            bulkServerKey: undefined,
            ratesPerMinute: { api: 55, file: 55, total: 55 },
            bulkShare: 0.5,
            maxWaitMs: { priority: 8000, bulk: 5000 },
            osuApiBaseUrl: "https://osu.ppy.sh/api",
            osuFileBaseUrl: "https://osu.ppy.sh/osu",
            recheckMinutes: { qualified: 15, pending: 60, graveyard: 1440 },
        });
    });

    it("reads every variable and strips trailing slashes from base URLs", () => {
        const config = loadConfig({
            OSU_API_KEY: "osu-key",
            INTERNAL_SERVER_KEY: "internal",
            BULK_SERVER_KEY: "bulk",
            OSU_API_RATE_LIMIT: "50",
            OSU_FILE_RATE_LIMIT: "40",
            OSU_TOTAL_RATE_LIMIT: "110",
            BULK_SHARE: "0.25",
            PRIORITY_MAX_WAIT_MS: "9000",
            BULK_MAX_WAIT_MS: "3000",
            OSU_API_BASE_URL: "http://127.0.0.1:1234/api/",
            OSU_FILE_BASE_URL: "http://127.0.0.1:1234/osu/",
            RECHECK_QUALIFIED_MINUTES: "10",
            RECHECK_PENDING_MINUTES: "30",
            RECHECK_GRAVEYARD_MINUTES: "10080",
        });

        expect(config).toMatchObject({
            internalServerKey: "internal",
            bulkServerKey: "bulk",
            ratesPerMinute: { api: 50, file: 40, total: 110 },
            bulkShare: 0.25,
            maxWaitMs: { priority: 9000, bulk: 3000 },
            osuApiBaseUrl: "http://127.0.0.1:1234/api",
            osuFileBaseUrl: "http://127.0.0.1:1234/osu",
            recheckMinutes: { qualified: 10, pending: 30, graveyard: 10080 },
        });
    });

    it("treats empty variables as unset", () => {
        expect(
            loadConfig({ OSU_API_KEY: "osu-key", BULK_SERVER_KEY: "" })
                .bulkServerKey,
        ).toBeUndefined();
    });

    it("names invalid variables without echoing secrets", () => {
        const attempt = () =>
            loadConfig({
                OSU_API_RATE_LIMIT: "0",
                BULK_SHARE: "1.5",
                INTERNAL_SERVER_KEY: "secret-value",
                BULK_SERVER_KEY: "secret-value",
            });

        expect(attempt).toThrow(ConfigError);
        expect(attempt).toThrow(/OSU_API_KEY/);
        expect(attempt).toThrow(/OSU_API_RATE_LIMIT/);
        expect(attempt).toThrow(/BULK_SHARE/);
        expect(attempt).not.toThrow(/secret-value/);
    });

    it("rejects using the same key for both lanes", () => {
        expect(() =>
            loadConfig({
                OSU_API_KEY: "osu-key",
                INTERNAL_SERVER_KEY: "same",
                BULK_SERVER_KEY: "same",
            }),
        ).toThrow(/BULK_SERVER_KEY must differ from INTERNAL_SERVER_KEY/);
    });
});
