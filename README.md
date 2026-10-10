# osu! beatmap processor

A dedicated backend for processing and caching osu! beatmaps.

## How to setup

To setup the server, you need:

- [Node.js](https://nodejs.org/en) v18 or later
- [PostgreSQL](https://www.postgresql.org/) v14 or later

Create an environment variable file (`.env`) in the root directory of the repository and fill it with the following variables:

```env
POSTGRES_HOSTNAME= # Hostname of PostgreSQL database
POSTGRES_PORT= # Port of PostgreSQL service
POSTGRES_DB_NAME= # The database name
POSTGRES_USERNAME= # PostgreSQL username
POSTGRES_PASSWORD= # PostgreSQL password
EXPRESS_PORT= # Port for Express server
OSU_API_KEY= # osu! APIv1 key
INTERNAL_SERVER_KEY= # Internal server key, if needed
```

### Setup Node.js dependencies

Begin by installing dependencies:

```
pnpm install
```

The project (ES modules) can be transpiled by running `pnpm build-linux` in Unix and `pnpm build-windows` in Windows, and started with `pnpm start`.

Before committing changes, run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm format:check`.

### osu! rate limits

osu! allows about 60 requests per minute for API calls and for `.osu` downloads. Every request to osu! goes
through one rate limiter in this service, in two lanes:

- **Priority** (`INTERNAL_SERVER_KEY`): the game, the bot, websites. Always served first.
- **Bulk** (`BULK_SERVER_KEY`): dpp processors and recalculations. Limited to `BULK_SHARE` of each budget.

When a request cannot be served within its lane's wait limit, or osu! answers `429`, the service answers `503`
with a `Retry-After` header instead of waiting or reporting "not found". A `404` always means osu! has no such
beatmap.

```env
OSU_API_KEY=            # osu! API v1 key (required)
INTERNAL_SERVER_KEY=    # key for the priority lane; if unset, every request gets the priority lane
BULK_SERVER_KEY=        # key for the bulk lane; give it to the dpp processors (their BEATMAP_SERVICE_KEY)
OSU_API_RATE_LIMIT=55   # get_beatmaps calls per minute
OSU_FILE_RATE_LIMIT=55  # .osu downloads per minute
OSU_TOTAL_RATE_LIMIT=55 # all osu! requests per minute (per-IP ceiling); 110 if downloads are counted separately
BULK_SHARE=0.5          # fraction of each budget the bulk lane may use
PRIORITY_MAX_WAIT_MS=8000
BULK_MAX_WAIT_MS=5000
RECHECK_QUALIFIED_MINUTES=15   # how long cached qualified beatmaps are trusted before re-checking their status
RECHECK_PENDING_MINUTES=60     # pending and WIP beatmaps
RECHECK_GRAVEYARD_MINUTES=1440 # graveyard beatmaps; ranked, approved, and loved beatmaps are never re-checked
```

`populateCache.ts` uses the bulk lane and is paced automatically, so it can run alongside the service.

### Setup PostgreSQL in Linux

Begin by installing packages:

```she
sudo apt update && apt upgrade
sudo apt install postgresql postgresql-contrib
```

After that, set the password of the default `postgres` user:

```she
sudo passwd postgres
```

You can then enable the PostgreSQL service and access the PostgreSQL terminal:

```she
sudo service postgresql start
sudo -u postgres psql
```

Create the database if it does not exist:

```sql
CREATE DATABASE <database_name_in_env_file>;
```

You can then import the SQL script in the root directory of this repository (make sure the `postgres` user can read the file):

```she
sudo -u postgres psql -U postgres -d <database_name_in_env_file> -f tables.sql
```
