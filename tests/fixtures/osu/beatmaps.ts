// Run directly by Node in scripts/record-golden.ts: erasable syntax only, `.ts` import extensions.
import type { OsuAPIResponse } from "@rian8337/osu-base";
import { createHash } from "node:crypto";
import type { FakeOsuState } from "./fakeOsu.ts";

export function computeFixtureMD5(data: Buffer | string): string {
    return createHash("md5").update(data).digest("hex");
}

/**
 * A small valid osu!standard `.osu` file with two circles (max combo 2). Different arguments give different MD5s.
 */
export function buildOsuFile(id: number, version: string): Buffer {
    return Buffer.from(
        [
            "osu file format v14",
            "",
            "[General]",
            "AudioFilename: audio.mp3",
            "Mode: 0",
            "",
            "[Metadata]",
            "Title:DISCO PRINCE",
            "Artist:Kenji Ninuma",
            "Creator:peppy",
            `Version:${version}`,
            `BeatmapID:${id.toString()}`,
            "BeatmapSetID:1",
            "",
            "[Difficulty]",
            "HPDrainRate:6",
            "CircleSize:4",
            "OverallDifficulty:6",
            "ApproachRate:6",
            "SliderMultiplier:1.4",
            "SliderTickRate:1",
            "",
            "[TimingPoints]",
            "0,500,4,2,0,100,1,0",
            "",
            "[HitObjects]",
            "256,192,1000,1,0,0:0:0:0:",
            "320,192,1500,1,0,0:0:0:0:",
            "",
        ].join("\r\n"),
    );
}

/**
 * An osu! API v1 `get_beatmaps` entry. Values are plain decimals so that they survive `real` columns unchanged.
 */
export function buildApiBeatmap(
    overrides: Partial<OsuAPIResponse> = {},
): OsuAPIResponse {
    return {
        approved: "1",
        submit_date: "2007-10-06 17:46:31",
        approved_date: "2007-10-06 17:46:31",
        last_update: "2007-10-06 17:46:31",
        artist: "Kenji Ninuma",
        beatmap_id: "75",
        beatmapset_id: "1",
        bpm: "119.5",
        creator: "peppy",
        creator_id: "2",
        difficultyrating: "2.5",
        diff_aim: "1.25",
        diff_speed: "1.125",
        diff_size: "4",
        diff_overall: "6",
        diff_approach: "6",
        diff_drain: "6",
        hit_length: "108",
        source: "",
        genre_id: "2",
        language_id: "3",
        title: "DISCO PRINCE",
        total_length: "142",
        version: "Normal",
        file_md5: "00000000000000000000000000000000",
        mode: "0",
        tags: "katamari",
        favourite_count: "100",
        rating: "8.5",
        playcount: "1000",
        passcount: "500",
        count_normal: "160",
        count_slider: "30",
        count_spinner: "4",
        max_combo: "314",
        storyboard: "0",
        video: "0",
        download_unavailable: "0",
        audio_unavailable: "0",
        packs: "S1,T44",
        ...overrides,
    };
}

/**
 * Beatmapset 1: beatmap 75 (standard, with a file), 76 (standard, osu! has no file), and 1001 (taiko, with a file).
 */
export function createGoldenOsuState(): FakeOsuState {
    const file75 = buildOsuFile(75, "Normal");
    const file1001 = buildOsuFile(1001, "Taiko");

    return {
        beatmaps: [
            buildApiBeatmap({ file_md5: computeFixtureMD5(file75) }),
            buildApiBeatmap({
                beatmap_id: "76",
                version: "Hard",
                file_md5: "11111111111111111111111111111111",
                max_combo: null,
            }),
            buildApiBeatmap({
                beatmap_id: "1001",
                version: "Taiko",
                mode: "1",
                file_md5: computeFixtureMD5(file1001),
            }),
        ],
        files: new Map([
            [75, file75],
            [1001, file1001],
        ]),
        rateLimited: false,
    };
}
