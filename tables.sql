-- PostgreSQL script

-- Beatmap table
CREATE TABLE IF NOT EXISTS beatmap (
    approved smallint NOT NULL,
    submit_date timestamp NOT NULL,
    approved_date timestamp,
    last_update timestamp NOT NULL,
    artist text NOT NULL,
    beatmap_id int NOT NULL,
    beatmapset_id int NOT NULL,
    bpm real NOT NULL,
    creator text NOT NULL,
    creator_id int NOT NULL,
    difficultyrating float,
    diff_aim float,
    diff_speed float,
    diff_size real NOT NULL,
    diff_overall real NOT NULL,
    diff_approach real NOT NULL,
    diff_drain real NOT NULL,
    hit_length int NOT NULL,
    source text,
    genre_id int NOT NULL,
    language_id int NOT NULL,
    title text NOT NULL,
    total_length int NOT NULL,
    version text NOT NULL,
    file_md5 varchar(32) NOT NULL,
    tags text NOT NULL,
    favourite_count int NOT NULL,
    rating real NOT NULL,
    playcount int NOT NULL,
    passcount int NOT NULL,
    count_normal int NOT NULL,
    count_slider int NOT NULL,
    count_spinner int NOT NULL,
    max_combo int,
    storyboard boolean NOT NULL,
    video boolean NOT NULL,
    download_unavailable boolean NOT NULL,
    audio_unavailable boolean NOT NULL,
    packs text,
    last_checked timestamp NOT NULL,

    PRIMARY KEY (beatmap_id)
);

CREATE INDEX IF NOT EXISTS beatmap_id_idx ON beatmap(beatmap_id);
CREATE INDEX IF NOT EXISTS beatmapset_id_idx ON beatmap(beatmapset_id);
CREATE INDEX IF NOT EXISTS beatmap_md5_idx ON beatmap(file_md5);
