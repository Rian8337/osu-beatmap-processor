import { describe, expect, it, vi } from "vitest";
import { OsuUnavailableError } from "../../../src/osu/errors.js";
import type { OsuGateway } from "../../../src/osu/OsuGateway.js";
import { RankedStatus } from "@rian8337/osu-base";
import {
    recheckBeatmap,
    recheckIntervalMs,
} from "../../../src/utils/beatmap/recheck.js";

function gatewayReturning(
    result: Awaited<ReturnType<OsuGateway["tryGetBeatmapNow"]>> | Error,
): Pick<OsuGateway, "tryGetBeatmapNow"> {
    return {
        tryGetBeatmapNow: vi.fn(() =>
            result instanceof Error
                ? Promise.reject(result)
                : Promise.resolve(result),
        ),
    };
}

describe("recheckIntervalMs", () => {
    const minutes = { qualified: 15, pending: 60, graveyard: 1440 };

    it.each([
        [RankedStatus.Qualified, 15 * 60_000],
        [RankedStatus.Pending, 60 * 60_000],
        [RankedStatus.Wip, 60 * 60_000],
        [RankedStatus.Graveyard, 1440 * 60_000],
    ])("re-checks status %i after %i ms", (status, expected) => {
        expect(recheckIntervalMs(status, minutes)).toBe(expected);
    });

    it.each([RankedStatus.Ranked, RankedStatus.Approved, RankedStatus.Loved])(
        "never re-checks status %i",
        (status) => {
            expect(recheckIntervalMs(status, minutes)).toBeNull();
        },
    );
});

describe("recheckBeatmap", () => {
    it("skips when the limiter is busy", async () => {
        expect(
            await recheckBeatmap(gatewayReturning(undefined), "bulk", 1),
        ).toEqual({
            kind: "skipped",
        });
    });

    it("skips when osu! is unavailable, so the cached beatmap is still served", async () => {
        expect(
            await recheckBeatmap(
                gatewayReturning(new OsuUnavailableError(5)),
                "priority",
                1,
            ),
        ).toEqual({ kind: "skipped" });
    });

    it("reports a beatmap osu! no longer has", async () => {
        expect(
            await recheckBeatmap(gatewayReturning(null), "priority", 1),
        ).toEqual({
            kind: "gone",
        });
    });

    it("returns the fresh beatmap", async () => {
        const fresh = { beatmap_id: "1", mode: "0" };

        expect(
            await recheckBeatmap(
                // Only the fields the recheck reads matter here.
                gatewayReturning(
                    fresh as unknown as Awaited<
                        ReturnType<OsuGateway["tryGetBeatmapNow"]>
                    >,
                ),
                "priority",
                1,
            ),
        ).toEqual({ kind: "fresh", beatmap: fresh });
    });

    it("lets unexpected errors through", async () => {
        await expect(
            recheckBeatmap(gatewayReturning(new Error("bug")), "priority", 1),
        ).rejects.toThrow("bug");
    });
});
