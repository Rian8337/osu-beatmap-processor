-- Reverts drizzle/0001_rewrite.sql so that the pre-rewrite build can run against the database again. Only valid
-- while 0001_rewrite is the latest applied migration. Database API keys are lost: run `key list` first and recreate
-- them after migrating forward again. Run with: psql -v ON_ERROR_STOP=1 -f docs/rollback/0001_rewrite.down.sql
BEGIN;

ALTER TABLE beatmap
    ALTER COLUMN submit_date TYPE timestamp USING submit_date AT TIME ZONE 'UTC',
    ALTER COLUMN approved_date TYPE timestamp USING approved_date AT TIME ZONE 'UTC',
    ALTER COLUMN last_update TYPE timestamp USING last_update AT TIME ZONE 'UTC',
    ALTER COLUMN last_checked TYPE timestamp USING last_checked AT TIME ZONE 'UTC';

CREATE INDEX IF NOT EXISTS beatmap_id_idx ON beatmap USING btree (beatmap_id);

DROP TABLE IF EXISTS beatmapset, cli_cursor, api_keys;

-- Forget 0001 so that the next start of the new build applies it again.
DELETE FROM drizzle.__drizzle_migrations
WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);

COMMIT;
