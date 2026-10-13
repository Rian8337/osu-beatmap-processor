import {
    formatOsuDate,
    parseOsuDate,
    convertApiResponseToRow,
    convertRowToApiResponse,
} from "@/beatmaps/converter";
import { buildApiBeatmap } from "@test/fixtures/osu/beatmaps";
import { RankedStatus } from "@rian8337/osu-base";
import { describe, expect, it } from "vitest";

describe("converter", () => {
    const checkedAt = new Date("2026-10-11T00:00:00Z");

    it("reads osu!'s dates as UTC", () => {
        const row = convertApiResponseToRow(buildApiBeatmap(), checkedAt);

        expect(row.submitDate).toEqual(new Date("2007-10-06T17:46:31Z"));
        expect(row.approvedDate).toEqual(new Date("2007-10-06T17:46:31Z"));
        expect(row.lastUpdate).toEqual(new Date("2007-10-06T17:46:31Z"));
        expect(row.lastChecked).toBe(checkedAt);
    });

    it("converts every field", () => {
        expect(convertApiResponseToRow(buildApiBeatmap(), checkedAt)).toEqual({
            approved: RankedStatus.Ranked,
            submitDate: new Date("2007-10-06T17:46:31Z"),
            approvedDate: new Date("2007-10-06T17:46:31Z"),
            lastUpdate: new Date("2007-10-06T17:46:31Z"),
            artist: "Kenji Ninuma",
            beatmapId: 75,
            beatmapsetId: 1,
            bpm: 119.5,
            creator: "peppy",
            creatorId: 2,
            difficultyRating: 2.5,
            diffAim: 1.25,
            diffSpeed: 1.125,
            diffSize: 4,
            diffOverall: 6,
            diffApproach: 6,
            diffDrain: 6,
            hitLength: 108,
            source: "",
            genreId: 2,
            languageId: 3,
            title: "DISCO PRINCE",
            totalLength: 142,
            version: "Normal",
            fileMd5: "00000000000000000000000000000000",
            tags: "katamari",
            favouriteCount: 100,
            rating: 8.5,
            playcount: 1000,
            passcount: 500,
            countNormal: 160,
            countSlider: 30,
            countSpinner: 4,
            maxCombo: 314,
            storyboard: false,
            video: false,
            downloadUnavailable: false,
            audioUnavailable: false,
            // The pre-rewrite service stores packs space-separated; kept for an identical response.
            packs: "S1 T44",
            lastChecked: checkedAt,
        });
    });

    it("keeps nulls", () => {
        const row = convertApiResponseToRow(
            buildApiBeatmap({
                approved: "-2",
                approved_date: null,
                max_combo: null,
                diff_aim: null,
                diff_speed: null,
                difficultyrating: null,
                packs: null,
            }),
        );

        expect(row).toMatchObject({
            approved: RankedStatus.Graveyard,
            approvedDate: null,
            maxCombo: null,
            diffAim: null,
            diffSpeed: null,
            difficultyRating: null,
            packs: "",
        });
    });

    it("answers the v1 format the pre-rewrite service answered", () => {
        const response = buildApiBeatmap({ storyboard: "1", audio_unavailable: "1" });

        expect(convertRowToApiResponse(convertApiResponseToRow(response))).toEqual({
            ...response,
            packs: "S1 T44",
        });
    });

    it("formats and parses osu! dates", () => {
        const date = new Date("2007-01-02T03:04:05Z");

        expect(formatOsuDate(date)).toBe("2007-01-02 03:04:05");
        expect(parseOsuDate("2007-01-02 03:04:05")).toEqual(date);
    });
});
