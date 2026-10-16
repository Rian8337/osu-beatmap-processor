import { KeyRepository } from "@/repositories/KeyRepository";
import { createTestDatabase } from "@test/utils/database";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

describe("KeyRepository", () => {
    it("inserts, lists, updates, and revokes keys", async () => {
        await using database = await createTestDatabase();
        const keys = new KeyRepository(database.db);

        await keys.insert({
            name: "site",
            keyHash: "a".repeat(64),
            lane: "bulk",
            rateLimitPerMinute: 120,
        });
        await keys.insert({
            name: "bot",
            keyHash: "b".repeat(64),
            lane: "priority",
            rateLimitPerMinute: null,
        });

        expect(await keys.listActive()).toEqual([
            {
                name: "bot",
                lane: "priority",
                rateLimitPerMinute: null,
                keyHash: "b".repeat(64),
            },
            {
                name: "site",
                lane: "bulk",
                rateLimitPerMinute: 120,
                keyHash: "a".repeat(64),
            },
        ]);

        await keys.update("site", {
            lane: "priority",
            rateLimitPerMinute: null,
        });

        expect(await keys.findByName("site")).toMatchObject({
            lane: "priority",
            rateLimitPerMinute: null,
            revokedAt: null,
        });

        expect(await keys.revoke("site")).toBe(true);
        expect(await keys.revoke("site")).toBe(false);
        expect((await keys.listActive()).map((k) => k.name)).toEqual(["bot"]);
        expect((await keys.list()).map((k) => k.name)).toEqual(["bot", "site"]);
        expect((await keys.findByName("site"))?.revokedAt).toBeInstanceOf(Date);
        expect(await keys.findByName("nobody")).toBeNull();
    });

    it("rejects a lane other than priority or bulk", async () => {
        await using database = await createTestDatabase();
        const keys = new KeyRepository(database.db);

        await expect(
            keys.insert({
                name: "odd",
                keyHash: "c".repeat(64),
                lane: "fast" as "bulk",
                rateLimitPerMinute: null,
            }),
        ).rejects.toMatchObject({
            cause: { code: "23514", constraint: "api_keys_lane_check" },
        });
    });
});
