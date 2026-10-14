# osu! beatmap processor

The beatmap service of the osu!droid infrastructure: the single place that serves beatmap metadata and `.osu` files from osu! (API v1). It caches beatmaps in memory, in PostgreSQL, and as `.osu` files on disk, and asks osu! only on a cache miss. Every osu! call goes through one rate limiter. Its callers are the game, the Discord bot, websites, the old dpp backend, and the dpp processors.

## Routes

All routes live under `/api/beatmap`. Every error body is `{ "error": string }`.

| Route                                    | Answer                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /getbeatmap?id=<id>` or `?hash=<md5>`     | `200`: the osu! API v1 beatmap object. When both parameters are given, `id` wins.                                 |
| `GET /getbeatmapfile?id=<id>` or `?hash=<md5>` | `200`: the `.osu` file (`text/plain`, `Content-Disposition: attachment; filename=<id>.osu`).                      |
| `GET /getbeatmaps?id=<beatmapset id>`    | `200`: an array of the set's standard-mode beatmaps (empty when the set has only other modes).                          |
| `GET /health`                            | `200 { "status": "ok" }` when the database answers; no key, no rate limit.                                              |

Errors, for every route:

| Status | Body                                  | Meaning                                                                                              |
| ------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `400`  | `{ "error": "Missing id or hash" }`   | Neither parameter was given (`/getbeatmaps`: `"Missing id"`).                                        |
| `400`  | `{ "error": "Invalid id" }`           | `id` is not `^\d+$`, or is 0 or above 2^31 - 1.                                                      |
| `400`  | `{ "error": "Invalid hash" }`         | `hash` is not 32 hex characters (any case is accepted).                                              |
| `401`  | `{ "error": "Unauthorized" }`         | Unknown or revoked key, or a header key and a query key that differ.                                 |
| `401`  | `{ "error": "API key required" }`     | No key while `ANON_RATE_LIMIT=0`.                                                                    |
| `404`  | `{ "error": "Beatmap not found" }`    | osu! has no such standard-mode beatmap (`"Beatmapset not found"` for sets, `"Beatmap file not found"` when the beatmap exists but osu! has no file for it). |
| `429`  | `{ "error": "Rate limit exceeded" }`  | The caller's per-minute limit was reached.                                                           |
| `503`  | `{ "error": ... }` + `Retry-After`    | osu! cannot be asked right now (rate limiter refusal, osu! `429`, or failure), or the database failed (`"Database unavailable"`, `Retry-After: 5`). |
| `500`  | `{ "error": "Internal server error" }` | Anything unhandled.                                                                                 |

A `404` with an `{ error }` body always means osu! has no such beatmap; anything temporary is a `503` with `Retry-After`. Unknown routes answer Express's default HTML `404` on purpose, so that a wrong path or base URL never looks like "beatmap not found".

## Access

- A key goes in the `X-Api-Key` header or the `key` query parameter. If both are present they must be equal.
- **Built-in keys**: `INTERNAL_SERVER_KEY` is the priority lane's key and `BULK_SERVER_KEY` the bulk lane's. Both are unlimited, and either can be left unset once every caller has a database key. Leaving `INTERNAL_SERVER_KEY` unset does not open the priority lane.
- **Database keys** are managed with the CLI (`key create`, see [CLI](#cli)). Each has a lane (`priority` or `bulk`) and a limit in requests per minute, or none. Only the key's SHA-256 hash is stored. The running service reloads keys every `KEY_RELOAD_INTERVAL_SECONDS`, so a database outage does not lock callers out.
- **Anonymous callers** (no key) use the bulk lane and are limited per IP to `ANON_RATE_LIMIT` requests per minute. With `ANON_RATE_LIMIT=0` a key is required.
- `TRUST_PROXY` is Express's `trust proxy` setting and decides which IP an anonymous request comes from: `false` (default), `true`, a hop count, or addresses and subnets. Behind nginx on the same machine, use `loopback`.

The per-caller limits cap requests to this service. The osu! budget behind it still applies to everyone through the lanes: a request that misses the cache spends osu! budget, a cached hit spends none.

## Setup

You need [Node.js](https://nodejs.org/en) 24 or later and [PostgreSQL](https://www.postgresql.org/) 14 or later, with an empty database for a new install.

```
pnpm install
pnpm build
```

Create `.env.${NODE_ENV}` in the root directory of the repository (`NODE_ENV` defaults to `development`; production runs with `NODE_ENV=production` and `.env.production`). Start from `.env.example`. Then run:

```
node dist/index.mjs
```

With PM2: `script: "dist/index.mjs"`, `env: { NODE_ENV: "production" }`. Pending database migrations are applied at startup. SIGTERM and SIGINT stop the server gracefully; SIGHUP reloads the keys.

## Configuration

Every variable is read once at startup, and a missing or invalid one stops the start with its name. An empty variable counts as unset.

| Variable                      | Default                     | Meaning                                                                                                   |
| ----------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `EXPRESS_PORT`                | `3000`                      | Port of the HTTP server.                                                                                  |
| `POSTGRES_HOSTNAME`           | required                    | Hostname of the PostgreSQL server.                                                                        |
| `POSTGRES_PORT`               | `5432`                      | Port of the PostgreSQL server.                                                                            |
| `POSTGRES_DB_NAME`            | required                    | Database name.                                                                                            |
| `POSTGRES_USERNAME`           | required                    | PostgreSQL user. It must own the `beatmap` table, since migrations alter it.                              |
| `POSTGRES_PASSWORD`           | empty                       | PostgreSQL password.                                                                                      |
| `OSU_API_KEY`                 | required                    | osu! API v1 key.                                                                                          |
| `INTERNAL_SERVER_KEY`         | unset                       | Built-in unlimited key for the priority lane.                                                             |
| `BULK_SERVER_KEY`             | unset                       | Built-in unlimited key for the bulk lane. Must differ from `INTERNAL_SERVER_KEY`.                         |
| `OSU_API_RATE_LIMIT`          | `55`                        | `get_beatmaps` calls per minute.                                                                          |
| `OSU_FILE_RATE_LIMIT`         | `55`                        | `.osu` downloads per minute.                                                                              |
| `OSU_TOTAL_RATE_LIMIT`        | `55`                        | All osu! requests per minute (per-IP ceiling); 110 if downloads are counted separately.                   |
| `BULK_SHARE`                  | `0.5`                       | Fraction of each osu! budget the bulk lane may use, above 0 and up to 1.                                  |
| `PRIORITY_MAX_WAIT_MS`        | `8000`                      | How long a priority request may wait for osu! budget before it gets a `503`.                              |
| `BULK_MAX_WAIT_MS`            | `5000`                      | The same for the bulk lane.                                                                               |
| `OSU_API_BASE_URL`            | `https://osu.ppy.sh/api`    | Base URL of the osu! API.                                                                                 |
| `OSU_FILE_BASE_URL`           | `https://osu.ppy.sh/osu`    | Base URL of `.osu` downloads.                                                                             |
| `BEATMAP_FILE_DIRECTORY`      | `beatmaps`                  | Where `.osu` files are stored; a relative path resolves from the working directory.                       |
| `RECHECK_QUALIFIED_MINUTES`   | `15`                        | How long a cached qualified beatmap is trusted before its status is re-checked with osu!.                 |
| `RECHECK_PENDING_MINUTES`     | `60`                        | The same for pending and WIP beatmaps.                                                                    |
| `RECHECK_GRAVEYARD_MINUTES`   | `1440`                      | The same for graveyard beatmaps. Ranked, approved, and loved beatmaps are never re-checked.               |
| `BEATMAP_CACHE_SIZE`          | `10000`                     | Entries of each of the memory caches by beatmap ID and by hash. Entries also expire after 15 minutes.     |
| `BEATMAPSET_CACHE_SIZE`       | `2000`                      | Entries of the memory cache of beatmapsets.                                                               |
| `ANON_RATE_LIMIT`             | `30`                        | Requests per minute per IP without a key. `0` requires a key.                                             |
| `KEY_RELOAD_INTERVAL_SECONDS` | `30`                        | How often the running service reloads the database keys.                                                  |
| `TRUST_PROXY`                 | `false`                     | Express's `trust proxy` setting; `loopback` behind nginx on the same machine.                             |

## osu! rate limits

osu! allows about 60 requests per minute for API calls and for `.osu` downloads. Every request to osu! goes through one rate limiter in this service, in two lanes. A caller's lane comes from its key:

- **Priority** (`INTERNAL_SERVER_KEY`, or a database key with `--lane priority`): the game, the bot, websites. Always served first.
- **Bulk** (`BULK_SERVER_KEY`, a database key with `--lane bulk`, or no key at all): dpp processors, recalculations, and anonymous callers. Limited to `BULK_SHARE` of each budget.

When a request cannot be served within its lane's wait limit, or osu! answers `429`, the service answers `503` with a `Retry-After` header instead of waiting or reporting "not found". A `404` always means osu! has no such beatmap. Give `BULK_SERVER_KEY` to the dpp processors as their `BEATMAP_SERVICE_KEY`.

## CLI

`node dist/cli.mjs <command>` (or `pnpm cli <command>`) uses the same environment as the server.

```
Usage: node dist/cli.mjs <command>

  key create <name> --lane <priority|bulk> (--limit <per-minute> | --unlimited)
  key update <name> [--lane <priority|bulk>] [--limit <per-minute> | --unlimited]
  key revoke <name>
  key list
  key show <name>

  db-baseline
  populate-cache [--files <dump directory>] [--move] [--restart]
  fix-dates [--restart]
```

- `key create` prints the key once; store it then, it cannot be shown again. Key commands make no osu! calls.
- After any key change, the running service applies it within `KEY_RELOAD_INTERVAL_SECONDS`, or at once after `pm2 sendSignal SIGHUP <app>`.
- `db-baseline` (also `pnpm db:baseline`) records the first migration as applied without running it. Run it once against a database that already has the pre-rewrite `beatmap` table; a fresh database needs no baseline.
- `populate-cache` walks osu!'s list of ranked and approved beatmaps and stores them, resuming from where the last run stopped (`--restart` starts over). With `--files <dump directory>`, a beatmap's file is taken from the osu! file dump instead of downloaded, when it is there and its MD5 matches. Extract the dump on the same machine first (for example `tar -xjf 2026_09_01_osu_files.tar.bz2 -C /srv/dumps`) and pass the extracted directory. Use `--move` only when the dump is on the same filesystem as `BEATMAP_FILE_DIRECTORY` and is no longer needed. Missing and mismatched files are downloaded on demand later. It prints the beatmaps stored, files copied, files missing, and files mismatched.
- `fix-dates` overwrites the dates and status of stored ranked, approved, and loved beatmaps with osu!'s values, which corrects the +8 hour dates in old rows. It never inserts. Other rows heal at their next re-check.

CLI commands have their own rate limiter, on the bulk lane, so they do not share a budget with the running service. Run them while the service is stopped, or give them their own `OSU_API_RATE_LIMIT`, `OSU_FILE_RATE_LIMIT`, and `OSU_TOTAL_RATE_LIMIT` so that both stay under osu!'s limit (for example, the service with `OSU_TOTAL_RATE_LIMIT=40` and the command with `OSU_TOTAL_RATE_LIMIT=15`).

## Upgrading from the pre-rewrite service

1. Stop the service. Check that `POSTGRES_USERNAME` owns the `beatmap` table, since the migration alters it. Run `pnpm db:baseline`, then start the new build (`dist/index.mjs`, `NODE_ENV=production`, `.env.production`), which applies the second migration.
2. With the service stopped or with split budgets: `fix-dates`, then `populate-cache --files <extracted dump>`.
3. Set `BULK_SERVER_KEY` as `BEATMAP_SERVICE_KEY` on every dpp processor, and on the old dpp backend while it recalculates.
4. Set `TRUST_PROXY` to match the reverse proxy before exposing the service, and choose `ANON_RATE_LIMIT`. Create database keys for public clients with `key create`; existing callers keep their built-in keys.
5. Check that `INTERNAL_SERVER_KEY` is set in production. If it was unset, every caller had the priority lane until now; after this change they become anonymous (bulk lane, limited per IP) unless they get a key.

## Rolling back

The old build cannot read the `timestamptz` columns the new one creates. Before starting the old build, run:

```
psql -v ON_ERROR_STOP=1 -f docs/rollback/0001_rewrite.down.sql
```

It converts the columns back, recreates the old index, drops the new tables, and forgets the second migration so that starting the new build again re-applies it. Database keys are lost: note them with `key list` first and recreate them after migrating forward again.

## Development

```
pnpm test           # unit and integration tests
pnpm test:e2e       # builds, then runs the built server and CLI
pnpm typecheck
pnpm lint
pnpm format
```

Tests need no database: they run PostgreSQL in-process with PGlite.
