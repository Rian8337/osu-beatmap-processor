# Beatmap Service Rewrite Design

Date: 2026-10-11
Status: Draft, pending review

## Context

This service is the single point of entry for beatmap metadata and `.osu` files across the osu!droid infrastructure: the game, the Discord bot, websites, the old dpp backend, and the new dpp processors. It caches beatmaps in memory, in Postgres, and as `.osu` files on disk, and calls osu! (API v1) on a cache miss. Every osu! call goes through `OsuGateway` and a two-lane `RateLimiter` (see `2026-10-10-osu-rate-limits-design.md`, merged and deployed 2026-10-11).

The code is a flat set of module-level functions and singletons (`getConfig()`, `getOsuGateway()`, `db`), which makes the storage logic hard to test: only the gateway, limiter, config, and helpers have tests. This rewrite restructures it in the style of `~/Projects/dpp-processor-backend-new` (dependency injection, interfaces at every boundary, unit/integration/e2e tests), fixes the weaknesses listed under **Improvements**, and folds in two open items: the UTC+8 dates in old rows and route-level id/hash validation.

**UTC+8 dates.** Rows cached long ago store their dates shifted by +8 hours: beatmap 75's `submit_date` is stored as 01:46:31, osu! returns 17:46:31 (the API returns UTC). The likely cause: the date columns are `timestamp` without time zone, and rows written before Drizzle (2025-04) were written in UTC+8 local time. Ranked, approved, and loved maps are never re-checked, so they were never corrected, and re-checks of other maps only update `approved` and `last_checked`.

**The osu! file dump.** osu! publishes a monthly dump of `.osu` files (`YYYY_MM_01_osu_files.tar.bz2`). Inspected with the September 2026 dump: 235,333 files in one flat directory named `<beatmap_id>.osu`, covering all four game modes, with no ranked status in the files. Old format versions (v8, v9) have no `BeatmapID` or `BeatmapSetID` lines, so the file name is the only reliable id. The dump is a source of files, not of metadata.

## Goals

- The same HTTP contract as today, plus validation: every caller keeps working unchanged, and malformed input gets `400`.
- Keep the rate-limit behaviour exactly: two lanes, `503` with `Retry-After` when osu! cannot be asked, and `404` only for a real "not found" (the dpp `BeatmapServiceClient` reads a `404` with a `{ error: string }` body as "not found").
- The dpp structure: `I*` interfaces and tsyringe tokens at every DI boundary, plumbing copied from `@dpp/server`, tooling matching dpp (tsdown, vitest, oxlint, oxfmt, Drizzle migrations, PGlite in tests).
- Cache whatever can be cached, including whole beatmapsets.
- Correct the UTC+8 dates, and make the schema unable to drift again.
- Populate the cache from osu!'s file dump without downloading files.
- Current versions of every dependency.
- Public access with managed API keys, as the dpp broker does it: per-key lanes and rate limits, anonymous callers limited per IP and kept off the priority lane.

## Non-goals

- Moving to osu! API v2.
- New or v2 routes. The contract is kept, not redesigned.
- Running several service processes: one process owns the rate limiter and the memory caches, as today.
- Usage statistics per caller (the broker's `UsageStats`). Only rate-limited keys are logged.
- Merging into the dpp monorepo. The game, the bot, and websites use this service too; it stays its own repository.

## Repository layout

One package (`osu-beatmap-processor`), not a workspace:

```
src/
  index.ts              server entry (dist/index.mjs)
  cli.ts                CLI entry (dist/cli.mjs)
  server/               copied from @dpp/server, same file names
  config/               zod-parsed environment → typed Config
  controllers/          BeatmapController, HealthController
  access/               key hashing, KeySnapshot, KeyService (+ IKeyService)
  middleware/           auth (caller → lane), per-caller rate limit
  services/             BeatmapService, BeatmapsetService, BeatmapFileService (+ I* interfaces)
  repositories/         BeatmapRepository, BeatmapsetRepository, CursorRepository, KeyRepository, BeatmapFileStore (+ I* interfaces)
  osu/                  OsuGateway, RateLimiter, errors (+ IOsuGateway)
  beatmaps/             pure helpers: v1 converter, validation, re-check intervals, MD5
  cache/                LruCache (dpp's, with expiry)
  cli/                  arguments, table, commands/{populateCache,fixDates,key}, SinceWalker
  dependencies/         tokens, register
  database/             schema, types
drizzle/                migrations
tests/{unit,integration,e2e}/
```

`src/server/` holds the parts of `@dpp/server` this service uses: the decorators (`Controller`, `Get`, `Injectable`), the router, `registerInjectables`, `BaseController`, `APIError`, `GracefulServer`, shutdown, logging (prefix `[beatmap-service]`), `loadEnvironmentVariables`, `DatabaseConnection`, and the test helpers (PGlite, ports, process). File names and contents stay as close to dpp's as possible so that `diff -r` against `packages/server/src` shows real drift only. Two deliberate differences: the error handlers produce this service's `{ error: string }` body, and there is no JSON not-found handler (see **HTTP contract**).

## Tooling and dependencies

| Today                                       | After                                                     |
| ------------------------------------------- | --------------------------------------------------------- |
| Express 4 + `express-async-handler`         | Express 5 (async handlers built in)                       |
| zod 3                                       | zod 4                                                     |
| drizzle-orm 0.41, drizzle-kit 0.30          | drizzle-orm 0.45, drizzle-kit 0.31                        |
| `@rian8337/osu-base` 4.0.0-beta.100         | 4.0.0-beta.102                                            |
| `tsc` build, TypeScript 5                   | tsdown build, TypeScript 7 for typechecking               |
| ESLint + Prettier                           | oxlint + oxfmt (dpp's `.oxlintrc.json`, `.oxfmtrc.json`)  |
| `dotenv`                                    | Node's `loadEnvFile` via `loadEnvironmentVariables`       |
| `pg` + `pg-native`                          | `pg` only                                                 |
| no DI                                       | `tsyringe` + `reflect-metadata`                           |

Kept: `cors`, `p-queue`, vitest 5, supertest. New: `express-rate-limit` (as in the broker). New for tests: `@electric-sql/pglite`, `@electric-sql/pglite-socket`. Every version is the current one when the plan is executed; the table names the minimum.

Module resolution follows dpp: the TypeScript configuration extends dpp's base settings (`moduleResolution: "bundler"`, `noEmit`, `allowImportingTsExtensions`, legacy decorators with metadata for tsyringe), and tsdown bundles the source into `dist/index.mjs` and `dist/cli.mjs`. Node loads only the bundles, so imports carry no `.js` extension. Imports that would climb a directory (`../`) use the aliases `@/*` (`src/*`) and `@test/*` (`tests/*`) instead, which tsdown and vitest's `resolve.alias` resolve; `./` imports stay relative, as in dpp.

Scripts follow dpp: `build`, `dev`, `typecheck`, `test`, `test:e2e`, `lint`, `format`, `db:generate`, `db:baseline`.

### Deployment changes

- The entry point moves from `dist/index.js` to `dist/index.mjs`; the PM2 config changes accordingly.
- Environment: `.env.${NODE_ENV}` (default `development`), as in dpp. Production runs with `NODE_ENV=production` and `.env.production`. Variable names are unchanged.
- The server applies pending migrations at startup. Before the first deploy, run `pnpm db:baseline` once against the production database (see **Migrations**).

## Architecture

```
cors → /api/beatmap router → key middleware (lane) → BeatmapController
                                                      │
              ┌───────────────────────────────────────┼─────────────────────┐
         IBeatmapService                       IBeatmapsetService     IBeatmapFileService
              │                                        │                     │
   ┌──────────┼───────────┐                 ┌──────────┼──────┐        ┌─────┴──────┐
memory   IBeatmapRepository  IOsuGateway   memory  IBeatmapsetRepository  IBeatmapFileStore
cache                        └ RateLimiter cache
```

### Interfaces and tokens

Every class that does I/O, or that another class depends on, is an `@Injectable(token)` class behind an `I*` interface; consumers receive the interface by token. Unit tests replace any of them with a fake.

| Interface               | Implementation          | Responsibility                                                                                   |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| `IOsuGateway`           | `OsuGateway`            | The only code that calls osu!. Ported unchanged, plus `getBeatmapsSince` (see **Since walker**). |
| `IBeatmapRepository`    | `BeatmapRepository`     | `beatmap` rows: find by id or hash, upsert, update, delete.                                      |
| `IBeatmapsetRepository` | `BeatmapsetRepository`  | `beatmapset` completeness rows, and the set transaction.                                         |
| `ICursorRepository`     | `CursorRepository`      | CLI resume points.                                                                               |
| `IKeyRepository`        | `KeyRepository`         | `api_keys` rows, for the key service and the `key` commands.                                     |
| `IKeyService`           | `KeyService`            | The in-memory key snapshot: authenticate, reload.                                                |
| `IBeatmapFileStore`     | `BeatmapFileStore`      | `.osu` files: read, atomic write, delete.                                                        |
| `IBeatmapService`       | `BeatmapService`        | One beatmap: memory → database → osu!, re-checks, invalidation on a hash change.                 |
| `IBeatmapsetService`    | `BeatmapsetService`     | One set: memory → complete set in database → osu!, re-checks.                                    |
| `IBeatmapFileService`   | `BeatmapFileService`    | A beatmap's `.osu` file: store → osu!, MD5 checks, max-combo backfill.                           |

`RateLimiter` stays a concrete class constructed with the gateway (its tests exercise it directly); the gateway receives it through its constructor. The configuration, the database, and the limiter are runtime instances registered at startup, as in the processor's `registerDependencies`.

Pure logic stays plain functions with direct unit tests: the v1 converter, id/hash validation, key hashing, re-check intervals, MD5, and the since walker's paging rule.

### Access

Modelled on the dpp broker (`apps/broker`: `registry/keys.ts`, `middleware/auth.ts`, `middleware/rateLimit.ts`, `cli/commands/key.ts`), with lanes in place of variant grants.

**Keys.** `api_keys (id serial PK, name text UNIQUE, key_hash char(64) UNIQUE, lane text NOT NULL CHECK (lane IN ('priority','bulk')), rate_limit_per_minute integer NULL, created_at timestamptz, revoked_at timestamptz NULL)`. A key is 32 random bytes, base64url-encoded; only its SHA-256 hash is stored. `rate_limit_per_minute` null means unlimited.

**Built-in keys.** `INTERNAL_SERVER_KEY` (priority lane) and `BULK_SERVER_KEY` (bulk lane), when set, keep working as two unlimited keys, so existing callers need no change. Once every caller has a database key they can be unset. A database key whose hash equals a built-in key's is rejected by `key create`.

**Snapshot.** `KeyService` holds every unrevoked key in memory, reloaded every `KEY_RELOAD_INTERVAL_SECONDS` (default 30) and on `SIGHUP`. A failed reload logs and keeps the previous snapshot; overlapping reloads never let an older one replace a newer one (as in the broker's `RegistryService`). Authentication never touches the database, so a database outage does not lock callers out. If the first load fails, startup fails.

**Authentication** (the auth middleware, on every route except `/health`):

- The key comes from the `X-Api-Key` header or the `key` query parameter (kept: the game, the bot, and the dpp processors send it today). Both present and different → `401`.
- A known key: the caller is that key, with its lane and limit.
- No key: an anonymous caller on the **bulk** lane, limited per IP by `ANON_RATE_LIMIT` (default 30 per minute). With `ANON_RATE_LIMIT=0`, a key is required: `401 { error: "API key required" }`.
- Any other key, including an empty or revoked one: `401 { error: "Unauthorized" }`. **Changed:** today, when `INTERNAL_SERVER_KEY` is unset, any key gets the priority lane; that rule is dropped.

The caller (and so the lane) is stored in typed request context, as the broker's `requestContext` does, instead of today's `WeakMap`.

**Per-caller rate limit** (after authentication): `express-rate-limit` with a one-minute window, counters in memory (one process). Keys by their own limit (skipped when unlimited), anonymous callers by IP (`ipKeyGenerator`). Over the limit: `429 { error: "Rate limit exceeded" }` with the draft-8 `RateLimit` headers, and one warning log line naming the key (never the key itself). Anonymous limits are not logged. Per-IP limits depend on `TRUST_PROXY`, Express's `trust proxy` setting, parsed as in the broker (`loopback` behind nginx on the same machine).

These limits cap requests to this service. The osu! budget behind it still applies to everyone through the lanes: an anonymous request that misses the cache spends bulk budget, and a cached hit spends none.

## HTTP contract

All routes live under `/api/beatmap`, authenticate as described under **Access**, and answer errors as `{ error: string }`.

### `GET /getbeatmap?id=<id>` or `?hash=<md5>`

- `200`: the v1 `OsuAPIResponse` object, converted from the stored row exactly as today.
- `404 { error: "Beatmap not found" }`: osu! has no such standard-mode beatmap.
- When both parameters are given, `id` wins.

### `GET /getbeatmapfile?id=<id>` or `?hash=<md5>`

- `200`: the file, `Content-Type: text/plain`, `Content-Disposition: attachment; filename=<id>.osu`.
- `404 { error: "Beatmap not found" }`: no such standard-mode beatmap.
- `404 { error: "Beatmap file not found" }`: the beatmap exists but osu! has no file for it.
- **Changed:** both `id` and `hash` resolve the beatmap's metadata first (memory → database → osu!), so every served file is checked against `file_md5` and stored next to its row. A non-standard-mode id now answers `404 "Beatmap not found"` instead of serving the file, and an id with no stored row costs one API call before the download.

### `GET /getbeatmaps?id=<beatmapset id>`

- `200`: an array of the set's standard-mode beatmaps (possibly empty when the set has only other modes, as today).
- `404 { error: "Beatmapset not found" }`.

### `GET /health`

- **New.** No key, no rate limit. `200 { status: "ok" }` when the database answers a trivial query, otherwise `503 { error: "Database unavailable" }`.

### Errors, for every route

| Status | Body                                     | When                                                                                                     |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `400`  | `{ error: "Missing id or hash" }`        | Neither parameter (for `/getbeatmaps`: `"Missing id"`). Fixes today's mismatched messages.               |
| `400`  | `{ error: "Invalid id" }`                | `id` is not `^\d+$`, or is 0 or above 2³¹−1. **New.**                                                    |
| `400`  | `{ error: "Invalid hash" }`              | `hash` is not 32 hex characters. Accepted in any case, lowercased before use. **New.**                   |
| `401`  | `{ error: "Unauthorized" }`              | Unknown or revoked key; header and query keys that differ.                                               |
| `401`  | `{ error: "API key required" }`          | No key while `ANON_RATE_LIMIT=0`. **New.**                                                               |
| `429`  | `{ error: "Rate limit exceeded" }`       | The caller's per-minute limit (see **Access**). **New.** The dpp client treats it as unavailable.        |
| `503`  | `{ error }` + `Retry-After`              | osu! cannot be asked (limiter refusal, `429`, failure), as today; or the database failed. **Database: new.** |
| `500`  | `{ error: "Internal server error" }`     | Anything unhandled. Today this is Express's HTML page.                                                   |

**Unknown routes keep Express's default HTML `404`, on purpose.** The dpp `BeatmapServiceClient` reads any `404` with a `{ error: string }` body as "beatmap not found"; a wrong path or base URL must not look like that. dpp's JSON `notFoundHandler` is therefore not copied.

## Caching

### Memory

`LruCache<K, V>`, copied from dpp's processor: a bounded LRU whose entries also expire 15 minutes after being set. Values are frozen; an update replaces the entry and never mutates a shared object. Three caches, each bounded by a configurable entry count:

| Cache       | Key            | Value                  | Default size (`*_CACHE_SIZE`) |
| ----------- | -------------- | ---------------------- | ----------------------------- |
| by id       | beatmap id     | beatmap row            | 10,000                        |
| by hash     | MD5            | beatmap row            | 10,000                        |
| sets        | beatmapset id  | the set's beatmap rows | 2,000                         |

### Single beatmaps (`BeatmapService.get(lane, id | hash)`)

The current logic, ported:

1. Memory cache, then the database, then osu! (`getBeatmap`). A miss at osu! is `null` (→ `404`).
2. On a lookup by hash that osu! answers: if a stored row with the same beatmap id has a different hash, the beatmap was updated. Invalidate: drop the old row, its file, its memory entries, and the set's `beatmapset` row (see below), then store the new row.
3. Re-check: once the status's interval has passed (ranked, approved, and loved: never), ask osu! only if the budget is idle (`tryGetBeatmapNow`). A busy or failed re-check serves the cached row unchanged. Gone → `null`. A new hash → invalidate as in step 2. Same hash → **changed:** update every mutable column from osu!'s answer (status, the four dates, counts, ratings, difficulty values, packs, `last_checked`), not only `approved` and `last_checked`. This is how non-ranked rows with UTC+8 dates heal.

Concurrent calls for the same beatmap share one in-flight lookup, keyed by beatmap, regardless of lane (**new**; today only the gateway's per-lane request sharing exists). When a priority call joins a lookup started by the bulk lane, it gets the bulk lookup's result or error.

### Beatmapsets (`BeatmapsetService.get(lane, setId)`)

**New: sets are stored in Postgres.** Rows alone cannot tell whether a set is complete (a single `/getbeatmap` call stores one difficulty), so a new table records completeness:

```
beatmapset (beatmapset_id integer PK, last_checked timestamptz NOT NULL)
```

A `beatmapset` row means "every standard-mode beatmap of this set was stored at `last_checked`".

1. Memory cache.
2. If a `beatmapset` row exists: read the set's rows from `beatmap` and serve them, unless the set is due for a re-check.
3. Otherwise, or when due: ask osu! (`getBeatmapset`). For a re-check, only when the budget is idle; a busy or failed re-check serves the stored set. A miss is `null` (→ `404`).
4. On an answer, in one transaction: upsert every standard-mode beatmap; delete stored rows of the set that osu! no longer lists; write the `beatmapset` row with `last_checked = now`. After the commit, delete the files of removed or rehashed beatmaps and refresh the memory caches.

Re-check interval: that of the set's most volatile status (a set containing a qualified beatmap is re-checked at the qualified interval; an all-ranked set never).

When `BeatmapService` invalidates a beatmap or finds it gone, it deletes the `beatmapset` row of its set, so the next set request goes back to osu! instead of serving a stale set.

### Files (`BeatmapFileService.get(lane, beatmap)`)

The caller passes the resolved beatmap row, so `file_md5` is always known.

1. Read `<BEATMAP_FILE_DIRECTORY>/<id>.osu`. If its MD5 matches `file_md5`, serve it. A mismatched file is deleted.
2. Otherwise download it (`downloadFile`). osu! has no file → `null` (→ `404 "Beatmap file not found"`).
3. **New:** check the downloaded file's MD5. On a mismatch, the beatmap was updated after its metadata was fetched: ask `BeatmapService` to refresh the beatmap from osu! once (on the same lane), and if the new hash matches the file, store both; otherwise answer `503` (osu! is serving inconsistent data; retrying later is correct) without caching the file.
4. **New:** files are written atomically: to `<id>.osu.<random>.tmp` in the same directory, then renamed.
5. Concurrent calls for the same beatmap share one in-flight download, regardless of lane.
6. Max-combo backfill, kept: when the row's `max_combo` is null, decode the file and store its max combo. It runs after the response is sent; a failure is logged.

### Database failures

**Changed:** today a failed database read is logged and treated as a cache miss, so a database outage turns every request into an osu! call and exhausts the budget within seconds. Now:

- A failed read throws `DatabaseUnavailableError`, answered as `503 { error: "Database unavailable" }` with `Retry-After: 5`, without calling osu!.
- A failed write (upsert, re-check update, max-combo backfill) is logged; the request is still served from the data in hand.

## Database

### Schema

- `beatmap`: today's columns as they exist in production (`pg_dump --schema-only`, 2026-10-11): the four flag columns (`storyboard`, `video`, `download_unavailable`, `audio_unavailable`) are `boolean`, not the `smallint` the current Drizzle schema claims, and the rewrite's schema says `boolean`. Indexes `beatmapset_id_idx` and `beatmap_md5_idx`; the redundant `beatmap_id_idx` (it duplicates the primary key) is dropped. `submit_date`, `approved_date`, `last_update`, and `last_checked` become `timestamptz`.
- `beatmapset`: new (see **Beatmapsets**).
- `cli_cursor (command text PK, cursor timestamptz NOT NULL)`: replaces `populate (id integer)`; one resume point per CLI command.
- `api_keys`: new (see **Access**).

The Drizzle schema uses `casing: "snake_case"`, as `DatabaseConnection` sets it; column names are unchanged.

### Migrations

- `0000_baseline`: exactly the production `beatmap` table from the schema dump, with its primary key and its three indexes. Production has no `populate` table (`populateCache.ts` never ran there), so the baseline has none.
- `0001_rewrite`: the four columns to `timestamptz` with `USING <column> AT TIME ZONE 'UTC'` (stored values keep their instants; wrong values are corrected by `fix-dates`, not by the migration); drop `beatmap_id_idx`; create `beatmapset`, `cli_cursor`, and `api_keys`; `DROP TABLE IF EXISTS populate` (local databases that ran `populateCache.ts` have it).

`pnpm db:baseline` records `0000_baseline` as applied in Drizzle's migration table without running it. It is run once against each existing database before the first deploy; a fresh database runs both migrations normally. `tables.sql` and `table_rollback.sql` are removed.

## CLI

`node dist/cli.mjs <command> [options]`, the same configuration and environment as the server, and its own `RateLimiter` instance on the bulk lane (a separate process, as `populateCache.ts` is today). The README keeps the rule: run CLI commands while the service is stopped, or give them their own `OSU_*_RATE_LIMIT` settings so that both stay under osu!'s limit.

### Since walker

osu! API v1 `get_beatmaps?since=<UTC datetime>&m=0&limit=500` returns up to 500 standard-mode beatmaps (no converts) approved from `since` onwards, ordered by approval date: every ranked, approved, loved, and qualified map. Walking it from 2007-01-01 to now covers all of them in roughly 500 calls, instead of one call per beatmap or set.

- `OsuGateway.getBeatmapsSince(lane, since)` makes one call through the limiter.
- `SinceWalker` loops: request from the cursor; hand the page to the command; move the cursor to **one second before** the page's last approval date, and save it after the command has processed the page. Pages therefore overlap by the maps of their last second, so maps tied at a page boundary are not lost whether osu! compares `since` inclusively or exclusively; upserts make the overlap harmless.
- If that would not move the cursor forward (a full page within one second), the cursor moves to the page's last approval date, or one second past the current cursor if that is later, and the walker logs that maps at that boundary may have been skipped.
- The walk ends on a page with fewer than 500 entries.
- Limiter refusals and `429`s wait out `Retry-After` and retry the same page, as `populateCache.ts` does today. Any other failure stops the command with a non-zero exit; rerunning it resumes from the cursor.
- Before the walker is built, a plan step checks against the live API that `since` accepts this date format and returns pages in approval-date order, and that a downloaded `.osu` file's MD5 equals its `file_md5` (the file service relies on it).

### `populate-cache [--files <dir>] [--move] [--restart]`

Walks with cursor `populate-cache`. For each page:

- Upserts the ranked and approved beatmaps (as today; loved and qualified are skipped).
- With `--files <dir>` (an extracted osu! file dump, any path): for each upserted beatmap, if `<dir>/<beatmap_id>.osu` exists and its MD5 matches `file_md5`, copy it into `BEATMAP_FILE_DIRECTORY` (atomically, as the file store does), or move it with `--move`. Missing and mismatched files are left to be downloaded on demand.
- Prints running and final totals: beatmaps stored, files copied, files missing, files mismatched.

It never marks sets complete: the walk returns beatmaps, not whole sets. `--restart` clears the cursor.

### `fix-dates [--restart]`

Walks with cursor `fix-dates`. For each beatmap in a page with status ranked, approved, or loved, it updates the four date columns and `approved` of an existing row; it never inserts. This corrects every row that is never re-checked, which is where the UTC+8 values are stuck; other rows heal at their next re-check (see **Single beatmaps**). It prints the number of rows updated and the number whose dates changed.

### `key create | update | revoke | list | show`

As the broker's `key` commands, with `--lane priority|bulk` in place of variant grants:

- `key create <name> --lane <lane> (--limit <per-minute> | --unlimited)`: prints the key once ("Store it now; it cannot be shown again").
- `key update <name> [--lane <lane>] [--limit <n> | --unlimited]`.
- `key revoke <name>`; `key list` (name, lane, limit, created, revoked); `key show <name>`.

Each change prints the reload reminder: the running service applies it within `KEY_RELOAD_INTERVAL_SECONDS`, or at once after `pm2 sendSignal SIGHUP <app>`. Key commands make no osu! calls, so they need no rate limit settings.

## Configuration

Unchanged variables: `POSTGRES_*`, `EXPRESS_PORT`, `OSU_API_KEY`, `INTERNAL_SERVER_KEY`, `BULK_SERVER_KEY`, `OSU_API_RATE_LIMIT`, `OSU_FILE_RATE_LIMIT`, `OSU_TOTAL_RATE_LIMIT`, `BULK_SHARE`, `PRIORITY_MAX_WAIT_MS`, `BULK_MAX_WAIT_MS`, `OSU_API_BASE_URL`, `OSU_FILE_BASE_URL`, `BEATMAP_FILE_DIRECTORY`, `RECHECK_*_MINUTES`.

New: `BEATMAP_CACHE_SIZE` (default 10,000; applies to the id and hash caches), `BEATMAPSET_CACHE_SIZE` (default 2,000), `ANON_RATE_LIMIT` (default 30; `0` requires a key), `KEY_RELOAD_INTERVAL_SECONDS` (default 30), and `TRUST_PROXY` (default `false`).

`INTERNAL_SERVER_KEY` and `BULK_SERVER_KEY` keep their names but change meaning slightly: each is now only a built-in key (see **Access**), and leaving `INTERNAL_SERVER_KEY` unset no longer opens the priority lane.

The PostgreSQL variables join the zod schema (today they are read raw in `database/index.ts`), so a missing one fails at startup with the variable's name. The configuration is loaded once in each entry point and registered in the container; nothing reads `process.env` afterwards.

## Runtime

- `GracefulServer` and the shutdown helpers: on `SIGTERM`/`SIGINT`, stop accepting connections, let in-flight requests finish (with a timeout), close the database pool.
- Every log line carries the `[beatmap-service]` prefix.
- Startup order: load the environment, parse the configuration (fail fast, as today), connect and migrate the database, load the key snapshot, create the limiter and the container, listen.
- `SIGHUP` reloads the key snapshot; the handler is installed before anything else, so a `SIGHUP` during startup does not hit Node's default action (exit), as in the broker.

## Testing

**Golden contract (written first).** Before any rewrite code, record one response per route and status from the **current** service against a stub osu! server: `200` bodies and headers for all three routes, every `404` body, `401`, `503` with `Retry-After`. The new service must produce the same bodies and headers, except where this spec marks a change.

**Unit** (`tests/unit`, no I/O): config parsing; key hashing; the key snapshot (authenticate, built-in keys, revoked keys, reload keeping the previous snapshot on failure, overlapping reloads); the auth middleware (header, query, both differing, anonymous, `ANON_RATE_LIMIT=0`); the rate-limit middleware (per key, per IP, unlimited, the warning line); id/hash validation; re-check intervals for beatmaps and sets; the v1 converter in both directions, including timestamptz round-trips; `LruCache`; `RateLimiter` and `OsuGateway`, ported with their current tests plus `getBeatmapsSince`; `BeatmapService`, `BeatmapsetService`, and `BeatmapFileService` against fake repositories, store, and gateway (cache order, invalidation, completeness, busy re-checks, re-checks rewriting dates, lane-independent sharing, MD5 checks after download, database failures → `503`, failed writes still served); the since walker (cursor, boundary overlap, a full page with one timestamp, retry after a refusal).

**Integration** (`tests/integration`, PGlite and temporary directories): repositories against the real migrations, including a row written as `timestamp` and migrated; the set transaction; `db:baseline` against a database created from the production schema dump; the rollback script restoring a schema the old build reads; the controllers through supertest for every status and body, including the HTML unknown-route `404`, `/health`, and `401`/`429` for database keys, built-in keys, and anonymous callers; the `key` commands against PGlite; the populate and fix-dates commands against a stub osu! server and a fake dump directory with a valid, a missing, and a mismatched file.

**E2E** (`tests/e2e`): the built `dist/index.mjs` against PGlite over a socket and a stub osu! server, asserting the dpp `BeatmapServiceClient` contract (the `beatmap_id` and `file_md5` fields, a `404` with a `{ error: string }` body, a `503` with `Retry-After`) and graceful shutdown. Servers are stopped by their recorded PID.

**Done when:** `pnpm test`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm lint`, and `pnpm format --check` pass, and a local smoke run of the built server answers the golden requests.

## Rollout

1. Stop the service. Check that `POSTGRES_USERNAME` owns the `beatmap` table, since the migration alters it. `pnpm db:baseline`, then start the new build (`dist/index.mjs`, `NODE_ENV=production`, `.env.production`), which applies `0001_rewrite`.
2. With the service stopped or with split budgets: `fix-dates`, then `populate-cache --files <extracted dump>`.
3. Carried over from the rate-limit rollout: set `BULK_SERVER_KEY` as `BEATMAP_SERVICE_KEY` on every dpp processor, and on the old dpp backend while it recalculates.
4. Set `TRUST_PROXY` to match the reverse proxy before exposing the service, and choose `ANON_RATE_LIMIT`. Create database keys for public clients with `key create`; existing callers keep their built-in keys.
5. Check that `INTERNAL_SERVER_KEY` is set in production: if it was unset, every caller had the priority lane until now, and after this change they become anonymous (bulk lane, limited per IP) unless they get a key.

Rolling back: the old build cannot read `timestamptz` columns (its Drizzle `timestamp()` columns append `+0000` to the value it reads, which yields invalid dates). `docs/rollback/0001_rewrite.down.sql` converts the four columns back with `USING <column> AT TIME ZONE 'UTC'`, recreates `beatmap_id_idx`, drops `beatmapset`, `cli_cursor`, and `api_keys`, and deletes `0001`'s row from Drizzle's migration table, so that starting the new build again re-applies `0001` cleanly. Database API keys are lost: note them with `key list` first and recreate them after migrating forward again. Run it before starting the old build. The down script is covered by an integration test.
