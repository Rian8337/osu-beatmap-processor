import type { BeatmapRow } from "@/database/types";
import { MapInfo, type OsuAPIResponse } from "@rian8337/osu-base";

const pad = (value: number) => value.toString().padStart(2, "0");

/**
 * Formats a date the way osu! API v1 does: `YYYY-MM-DD HH:MM:SS` in UTC.
 */
export function formatOsuDate(date: Date): string {
    return `${date.getUTCFullYear().toString()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/**
 * Parses an osu! API v1 date (`YYYY-MM-DD HH:MM:SS`, UTC).
 */
export function parseOsuDate(text: string): Date {
    const [year = 0, month = 1, day = 1, hours = 0, minutes = 0, seconds = 0] =
        text.split(/[- :]/).map(Number);

    return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
}

/**
 * Converts an osu! API v1 beatmap into a row. Goes through osu-base's `MapInfo`, as the pre-rewrite service did, so
 * stored values (and so responses) stay identical: dates as UTC, packs space-separated, missing packs as "".
 *
 * @param checkedAt The `lastChecked` value. Defaults to now.
 */
export function convertApiResponseToRow(
    response: OsuAPIResponse,
    checkedAt = new Date(),
): BeatmapRow {
    const info = MapInfo.from(response);

    return {
        approved: info.approved,
        submitDate: info.submitDate,
        approvedDate: info.approvedDate,
        lastUpdate: info.lastUpdate,
        artist: info.artist,
        beatmapId: info.beatmapId,
        beatmapsetId: info.beatmapSetId,
        bpm: info.bpm,
        creator: info.creator,
        creatorId: info.creatorId,
        difficultyRating: info.totalDifficulty,
        diffAim: info.aimDifficulty,
        diffSpeed: info.speedDifficulty,
        diffSize: info.cs,
        diffOverall: info.od,
        diffApproach: info.ar,
        diffDrain: info.hp,
        hitLength: info.hitLength,
        source: info.source,
        genreId: info.genre,
        languageId: info.language,
        title: info.title,
        totalLength: info.totalLength,
        version: info.version,
        fileMd5: info.hash,
        tags: info.tags.join(" "),
        favouriteCount: info.favorites,
        rating: info.rating,
        playcount: info.plays,
        passcount: info.passes,
        countNormal: info.circles,
        countSlider: info.sliders,
        countSpinner: info.spinners,
        maxCombo: info.maxCombo,
        storyboard: info.storyboardAvailable,
        video: info.videoAvailable,
        downloadUnavailable: !info.downloadAvailable,
        audioUnavailable: !info.audioAvailable,
        packs: info.packs.join(" "),
        lastChecked: checkedAt,
    };
}

/**
 * Converts a row into the osu! API v1 format this service answers with.
 */
export function convertRowToApiResponse(row: BeatmapRow): OsuAPIResponse {
    return {
        approved: row.approved.toString(),
        submit_date: formatOsuDate(row.submitDate),
        approved_date: row.approvedDate
            ? formatOsuDate(row.approvedDate)
            : null,
        last_update: formatOsuDate(row.lastUpdate),
        artist: row.artist,
        beatmap_id: row.beatmapId.toString(),
        beatmapset_id: row.beatmapsetId.toString(),
        bpm: row.bpm.toString(),
        creator: row.creator,
        creator_id: row.creatorId.toString(),
        difficultyrating: row.difficultyRating?.toString() ?? null,
        diff_aim: row.diffAim?.toString() ?? null,
        diff_speed: row.diffSpeed?.toString() ?? null,
        diff_size: row.diffSize.toString(),
        diff_overall: row.diffOverall.toString(),
        diff_approach: row.diffApproach.toString(),
        diff_drain: row.diffDrain.toString(),
        hit_length: row.hitLength.toString(),
        source: row.source,
        genre_id: row.genreId.toString(),
        language_id: row.languageId.toString(),
        title: row.title,
        total_length: row.totalLength.toString(),
        version: row.version,
        file_md5: row.fileMd5,
        // Only osu!standard beatmaps are stored.
        mode: "0",
        tags: row.tags,
        favourite_count: row.favouriteCount.toString(),
        rating: row.rating.toString(),
        playcount: row.playcount.toString(),
        passcount: row.passcount.toString(),
        count_normal: row.countNormal.toString(),
        count_slider: row.countSlider.toString(),
        count_spinner: row.countSpinner.toString(),
        max_combo: row.maxCombo?.toString() ?? null,
        storyboard: row.storyboard ? "1" : "0",
        video: row.video ? "1" : "0",
        download_unavailable: row.downloadUnavailable ? "1" : "0",
        audio_unavailable: row.audioUnavailable ? "1" : "0",
        packs: row.packs ?? null,
    };
}
