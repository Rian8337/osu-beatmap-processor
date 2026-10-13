import {
    isRecheckDue,
    getRecheckIntervalMs,
    getBeatmapsetRecheckIntervalMs,
} from "@/beatmaps/recheck";
import { RankedStatus } from "@rian8337/osu-base";
import { describe, expect, it } from "vitest";

const minutes = { qualified: 15, pending: 60, graveyard: 1440 };

describe("getRecheckIntervalMs", () => {
    it.each([
        [RankedStatus.Ranked, null],
        [RankedStatus.Approved, null],
        [RankedStatus.Loved, null],
        [RankedStatus.Qualified, 15 * 60_000],
        [RankedStatus.Pending, 60 * 60_000],
        [RankedStatus.Wip, 60 * 60_000],
        [RankedStatus.Graveyard, 1440 * 60_000],
    ])("status %d → %j", (status, expected) => {
        expect(getRecheckIntervalMs(status, minutes)).toBe(expected);
    });

    it("treats an unknown status as pending", () => {
        expect(getRecheckIntervalMs(9 as RankedStatus, minutes)).toBe(60 * 60_000);
    });
});

describe("getBeatmapsetRecheckIntervalMs", () => {
    it("uses the most volatile status", () => {
        expect(
            getBeatmapsetRecheckIntervalMs(
                [RankedStatus.Ranked, RankedStatus.Qualified, RankedStatus.Graveyard],
                minutes,
            ),
        ).toBe(15 * 60_000);
    });

    it("never re-checks an all-ranked set", () => {
        expect(
            getBeatmapsetRecheckIntervalMs([RankedStatus.Ranked, RankedStatus.Loved], minutes),
        ).toBeNull();
    });

    it("re-checks a set without standard beatmaps like a graveyard one", () => {
        expect(getBeatmapsetRecheckIntervalMs([], minutes)).toBe(1440 * 60_000);
    });
});

describe("isRecheckDue", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");

    it("is due once the interval has passed", () => {
        expect(isRecheckDue(new Date(now - 61_000), 60_000, now)).toBe(true);
        expect(isRecheckDue(new Date(now - 59_000), 60_000, now)).toBe(false);
    });

    it("is never due without an interval", () => {
        expect(isRecheckDue(new Date(0), null, now)).toBe(false);
    });
});
