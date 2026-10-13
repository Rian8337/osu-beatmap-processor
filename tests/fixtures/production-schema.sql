-- The production beatmap table as of 2026-10-11 (pg_dump --schema-only). The baseline migration must match it.
CREATE TABLE public.beatmap (
    approved smallint NOT NULL,
    submit_date timestamp without time zone NOT NULL,
    approved_date timestamp without time zone,
    last_update timestamp without time zone NOT NULL,
    artist text NOT NULL,
    beatmap_id integer NOT NULL,
    beatmapset_id integer NOT NULL,
    bpm real NOT NULL,
    creator text NOT NULL,
    creator_id integer NOT NULL,
    difficultyrating double precision,
    diff_aim double precision,
    diff_speed double precision,
    diff_size real NOT NULL,
    diff_overall real NOT NULL,
    diff_approach real NOT NULL,
    diff_drain real NOT NULL,
    hit_length integer NOT NULL,
    source text NOT NULL,
    genre_id integer NOT NULL,
    language_id integer NOT NULL,
    title text NOT NULL,
    total_length integer NOT NULL,
    version text NOT NULL,
    file_md5 character varying(32) NOT NULL,
    tags text NOT NULL,
    favourite_count integer NOT NULL,
    rating real NOT NULL,
    playcount integer NOT NULL,
    passcount integer NOT NULL,
    count_normal integer NOT NULL,
    count_slider integer NOT NULL,
    count_spinner integer NOT NULL,
    max_combo integer,
    storyboard boolean NOT NULL,
    video boolean NOT NULL,
    download_unavailable boolean NOT NULL,
    audio_unavailable boolean NOT NULL,
    packs text,
    last_checked timestamp without time zone NOT NULL
);

ALTER TABLE ONLY public.beatmap
    ADD CONSTRAINT beatmap_pkey PRIMARY KEY (beatmap_id);

CREATE INDEX beatmap_id_idx ON public.beatmap USING btree (beatmap_id);

CREATE INDEX beatmap_md5_idx ON public.beatmap USING btree (file_md5);

CREATE INDEX beatmapset_id_idx ON public.beatmap USING btree (beatmapset_id);
