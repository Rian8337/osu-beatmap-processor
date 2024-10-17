import {
    BeatmapGenre,
    BeatmapLanguage,
    RankedStatus,
} from "@rian8337/osu-base";

/**
 * Represents a beatmap in the database.
 */
export interface DatabaseBeatmap {
    /**
     * The ranking status of the beatmap.
     */
    approved: RankedStatus;

    /**
     * The date the beatmap was submitted.
     */
    readonly submit_date: Date;

    /**
     * The date the beatmap was approved, if it has been approved.
     */
    readonly approved_date: Date | null;

    /**
     * The date the beatmap was last updated.
     */
    readonly last_update: Date;

    /**
     * The artist of the song.
     */
    readonly artist: string;

    /**
     * The beatmap ID.
     */
    readonly beatmap_id: number;

    /**
     * The beatmapset ID.
     */
    readonly beatmapset_id: number;

    /**
     * The BPM of the song.
     */
    readonly bpm: number;

    /**
     * The creator of the beatmap.
     */
    readonly creator: string;

    /**
     * The ID of the creator.
     */
    readonly creator_id: number;

    /**
     * The difficulty rating of the beatmap.
     *
     * In unranked beatmaps, this may not exist.
     */
    readonly difficultyrating: number | null;

    /**
     * The aim difficulty rating of the beatmap.
     *
     * In unranked beatmaps, this may not exist.
     */
    readonly diff_aim: number | null;

    /**
     * The speed difficulty rating of the beatmap.
     *
     * In unranked beatmaps, this may not exist.
     */
    readonly diff_speed: number | null;

    /**
     * The circle size of the beatmap.
     */
    readonly diff_size: number;

    /**
     * The overall difficulty of the beatmap.
     */
    readonly diff_overall: number;

    /**
     * The approach rate of the beatmap.
     */
    readonly diff_approach: number;

    /**
     * The HP drain of the beatmap.
     */
    readonly diff_drain: number;

    /**
     * The duration of the beatmap not including breaks.
     */
    readonly hit_length: number;

    /**
     * The source of the song.
     */
    readonly source: string;

    /**
     * The genre of the song.
     */
    readonly genre_id: BeatmapGenre;

    /**
     * The language of the song.
     */
    readonly language_id: BeatmapLanguage;

    /**
     * The title of the song.
     */
    readonly title: string;

    /**
     * The duration of the beatmap including breaks.
     */
    readonly total_length: number;

    /**
     * The difficulty name of the beatmap.
     */
    readonly version: string;

    /**
     * The MD5 hash of the beatmap.
     */
    readonly file_md5: string;

    /**
     * The tags of the beatmap.
     */
    readonly tags: string;

    /**
     * The favorite count of the beatmap.
     */
    readonly favourite_count: number;

    /**
     * The rating of the beatmap.
     */
    readonly rating: number;

    /**
     * The play count of the beatmap.
     */
    readonly playcount: number;

    /**
     * The pass count of the beatmap.
     */
    readonly passcount: number;

    /**
     * The maximum combo of the beatmap.
     */
    readonly count_normal: number;

    /**
     * The amount of sliders in the beatmap.
     */
    readonly count_slider: number;

    /**
     * The amount of spinners in the beatmap.
     */
    readonly count_spinner: number;

    /**
     * The maximum combo of the beatmap.
     *
     * May be `null` if the beatmap is unranked.
     */
    max_combo: number | null;

    /**
     * Whether the beatmap has a storyboard.
     */
    readonly storyboard: boolean;

    /**
     * Whether the beatmap has a video.
     */
    readonly video: boolean;

    /**
     * Whether the download for the beatmap is unavailable (old map, etc.)
     */
    readonly download_unavailable: boolean;

    /**
     * Whether the audio for the beatmap is unavailable (DMCA takedown, etc.)
     */
    readonly audio_unavailable: boolean;

    /**
     * The IDs of beatmap packs this beatmap is included in, separated by space, if any.
     */
    readonly packs: string | null;

    /**
     * The date the beatmap was last checked for updates.
     */
    last_checked: Date;
}
