import { MapInfo, OsuAPIResponse } from "@rian8337/osu-base";
import { DatabaseBeatmap } from "../../database/schema/DatabaseBeatmap";

const padDateNumber = (num: number) => num.toString().padStart(2, "0");

const dateToOsuAPIResponse = (date: Date) =>
    `${date.getUTCFullYear().toString()}-${padDateNumber(
        date.getUTCMonth() + 1,
    )}-${padDateNumber(date.getUTCDate())} ${padDateNumber(
        date.getUTCHours(),
    )}:${padDateNumber(date.getUTCMinutes())}:${padDateNumber(
        date.getUTCSeconds(),
    )}`;

const convertOsuAPIResponseDate = (str: string): Date => {
    const t = str.split(/[- :]/).map((e) => parseInt(e));

    return new Date(Date.UTC(t[0], t[1] - 1, t[2], t[3], t[4], t[5]));
};

/**
 * Converts a `MapInfo` instance into a beatmap object that can be inserted into the database.
 *
 * @param mapinfo The `MapInfo` instance to convert.
 * @returns The converted beatmap object.
 */
export function convertMapInfoToDatabaseBeatmap(
    mapinfo: MapInfo<false>,
): DatabaseBeatmap {
    return {
        approved: mapinfo.approved,
        approved_date: mapinfo.approvedDate,
        artist: mapinfo.artist,
        audio_unavailable: !mapinfo.audioAvailable,
        beatmap_id: mapinfo.beatmapId,
        beatmapset_id: mapinfo.beatmapSetId,
        bpm: mapinfo.bpm,
        count_normal: mapinfo.circles,
        count_slider: mapinfo.sliders,
        count_spinner: mapinfo.spinners,
        creator: mapinfo.creator,
        creator_id: mapinfo.creatorId,
        diff_aim: mapinfo.aimDifficulty,
        diff_approach: mapinfo.ar,
        diff_drain: mapinfo.hp,
        diff_overall: mapinfo.od,
        diff_size: mapinfo.cs,
        diff_speed: mapinfo.speedDifficulty,
        difficultyrating: mapinfo.totalDifficulty,
        download_unavailable: !mapinfo.downloadAvailable,
        favourite_count: mapinfo.favorites,
        file_md5: mapinfo.hash,
        genre_id: mapinfo.genre,
        hit_length: mapinfo.hitLength,
        language_id: mapinfo.language,
        last_checked: new Date(),
        last_update: mapinfo.lastUpdate,
        max_combo: mapinfo.maxCombo,
        packs: mapinfo.packs.join(" "),
        passcount: mapinfo.passes,
        playcount: mapinfo.plays,
        source: mapinfo.source,
        title: mapinfo.title,
        rating: mapinfo.rating,
        storyboard: mapinfo.storyboardAvailable,
        submit_date: mapinfo.submitDate,
        tags: mapinfo.tags.join(" "),
        total_length: mapinfo.totalLength,
        version: mapinfo.version,
        video: mapinfo.videoAvailable,
    };
}

/**
 * Converts a beatmap object from the database into an osu! API response.
 *
 * @param beatmap The beatmap to convert.
 * @returns The converted osu! API response.
 */
export function convertDatabaseBeatmapToOsuAPIResponse(
    beatmap: DatabaseBeatmap,
): OsuAPIResponse {
    return {
        approved: beatmap.approved.toString(),
        submit_date: dateToOsuAPIResponse(beatmap.submit_date),
        approved_date: beatmap.approved_date
            ? dateToOsuAPIResponse(beatmap.approved_date)
            : null,
        last_update: dateToOsuAPIResponse(beatmap.last_update),
        artist: beatmap.artist,
        beatmap_id: beatmap.beatmap_id.toString(),
        beatmapset_id: beatmap.beatmapset_id.toString(),
        bpm: beatmap.bpm.toString(),
        creator: beatmap.creator,
        creator_id: beatmap.creator_id.toString(),
        difficultyrating: beatmap.difficultyrating?.toString() ?? null,
        diff_aim: beatmap.diff_aim?.toString() ?? null,
        diff_speed: beatmap.diff_speed?.toString() ?? null,
        diff_size: beatmap.diff_size.toString(),
        diff_overall: beatmap.diff_overall.toString(),
        diff_approach: beatmap.diff_approach.toString(),
        diff_drain: beatmap.diff_drain.toString(),
        hit_length: beatmap.hit_length.toString(),
        source: beatmap.source,
        genre_id: beatmap.genre_id.toString(),
        language_id: beatmap.language_id.toString(),
        title: beatmap.title,
        total_length: beatmap.total_length.toString(),
        version: beatmap.version,
        file_md5: beatmap.file_md5,
        // Guaranteed to be osu!standard for the time being.
        mode: "0",
        tags: beatmap.tags,
        favourite_count: beatmap.favourite_count.toString(),
        rating: beatmap.rating.toString(),
        playcount: beatmap.playcount.toString(),
        passcount: beatmap.passcount.toString(),
        count_normal: beatmap.count_normal.toString(),
        count_slider: beatmap.count_slider.toString(),
        count_spinner: beatmap.count_spinner.toString(),
        max_combo: beatmap.max_combo?.toString() ?? null,
        storyboard: beatmap.storyboard ? "1" : "0",
        video: beatmap.video ? "1" : "0",
        download_unavailable: beatmap.download_unavailable ? "1" : "0",
        audio_unavailable: beatmap.audio_unavailable ? "1" : "0",
        packs: beatmap.packs ?? null,
    };
}

export function convertOsuAPIResponseToDatabaseBeatmap(
    response: OsuAPIResponse,
): DatabaseBeatmap {
    return {
        approved: parseInt(response.approved),
        approved_date: response.approved_date
            ? convertOsuAPIResponseDate(response.approved_date)
            : null,
        artist: response.artist,
        audio_unavailable: response.audio_unavailable === "1",
        beatmap_id: parseInt(response.beatmap_id),
        beatmapset_id: parseInt(response.beatmapset_id),
        bpm: parseFloat(response.bpm),
        count_normal: parseInt(response.count_normal),
        count_slider: parseInt(response.count_slider),
        count_spinner: parseInt(response.count_spinner),
        creator: response.creator,
        creator_id: parseInt(response.creator_id),
        diff_aim: response.diff_aim ? parseFloat(response.diff_aim) : null,
        diff_approach: parseFloat(response.diff_approach),
        diff_drain: parseFloat(response.diff_drain),
        diff_overall: parseFloat(response.diff_overall),
        diff_size: parseFloat(response.diff_size),
        diff_speed: response.diff_speed
            ? parseFloat(response.diff_speed)
            : null,
        difficultyrating: response.difficultyrating
            ? parseFloat(response.difficultyrating)
            : null,
        download_unavailable: response.download_unavailable === "1",
        favourite_count: parseInt(response.favourite_count),
        file_md5: response.file_md5,
        genre_id: parseInt(response.genre_id),
        hit_length: parseInt(response.hit_length),
        language_id: parseInt(response.language_id),
        last_checked: new Date(),
        last_update: convertOsuAPIResponseDate(response.last_update),
        max_combo:
            response.max_combo !== null ? parseInt(response.max_combo) : null,
        packs: response.packs,
        passcount: parseInt(response.passcount),
        playcount: parseInt(response.playcount),
        source: response.source,
        storyboard: response.storyboard === "1",
        submit_date: convertOsuAPIResponseDate(response.submit_date),
        tags: response.tags,
        title: response.title,
        total_length: parseInt(response.total_length),
        version: response.version,
        video: response.video === "1",
        rating: parseFloat(response.rating),
    };
}
