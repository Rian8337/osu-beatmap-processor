import { hashApiKey } from "@/access/keys";
import { buildKeySnapshot } from "@/access/snapshot";
import { describe, expect, it } from "vitest";

describe("buildKeySnapshot", () => {
    it("holds the built-in keys and the stored keys by hash", () => {
        const snapshot = buildKeySnapshot(
            [
                {
                    name: "site",
                    lane: "bulk",
                    rateLimitPerMinute: 120,
                    keyHash: hashApiKey("site-key"),
                },
            ],
            { priority: "internal", bulk: "bulk" },
        );

        expect(snapshot.get(hashApiKey("internal"))).toEqual({
            name: "built-in:priority",
            lane: "priority",
            rateLimitPerMinute: null,
        });
        expect(snapshot.get(hashApiKey("bulk"))).toEqual({
            name: "built-in:bulk",
            lane: "bulk",
            rateLimitPerMinute: null,
        });
        expect(snapshot.get(hashApiKey("site-key"))).toEqual({
            name: "site",
            lane: "bulk",
            rateLimitPerMinute: 120,
        });
    });

    it("leaves out unset built-in keys, and lets a built-in key win a collision", () => {
        const snapshot = buildKeySnapshot(
            [
                {
                    name: "copy",
                    lane: "bulk",
                    rateLimitPerMinute: 1,
                    keyHash: hashApiKey("internal"),
                },
            ],
            { priority: "internal", bulk: undefined },
        );

        expect(snapshot.size).toBe(1);
        expect(snapshot.get(hashApiKey("internal"))?.name).toBe(
            "built-in:priority",
        );
    });
});
