CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" char(64) NOT NULL,
	"lane" text NOT NULL,
	"rate_limit_per_minute" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_name_unique" UNIQUE("name"),
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "api_keys_lane_check" CHECK ("api_keys"."lane" in ('priority', 'bulk'))
);
--> statement-breakpoint
CREATE TABLE "beatmapset" (
	"beatmapset_id" integer PRIMARY KEY NOT NULL,
	"last_checked" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cli_cursor" (
	"command" text PRIMARY KEY NOT NULL,
	"cursor" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX "beatmap_id_idx";--> statement-breakpoint
ALTER TABLE "beatmap" ALTER COLUMN "submit_date" SET DATA TYPE timestamp with time zone USING "submit_date" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "beatmap" ALTER COLUMN "approved_date" SET DATA TYPE timestamp with time zone USING "approved_date" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "beatmap" ALTER COLUMN "last_update" SET DATA TYPE timestamp with time zone USING "last_update" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "beatmap" ALTER COLUMN "last_checked" SET DATA TYPE timestamp with time zone USING "last_checked" AT TIME ZONE 'UTC';
--> statement-breakpoint
DROP TABLE IF EXISTS "populate";
