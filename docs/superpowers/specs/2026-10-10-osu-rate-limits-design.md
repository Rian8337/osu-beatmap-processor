# osu! Rate Limits Design

Date: 2026-10-10
Status: Draft, pending review

## Context

The beatmap processor is the single point of entry for beatmap metadata and `.osu` files across the osu!droid infrastructure: the game itself, the Discord bot, websites, the old dpp backend, and the new dpp processors (`~/Projects/dpp-processor-backend-new`). It caches beatmaps in memory (15 minutes), in Postgres, and as `.osu` files on disk, and calls osu! on a cache miss.

osu! has lowered its rate limit from 1200 to 60 requests per minute. It applies to API calls (`get_beatmaps`, per API key and possibly per IP) and to `.osu` downloads from `osu.ppy.sh/osu/{id}` (per IP). Whether the two share one budget is unknown.

Today the service has no rate limiting. Score recalculations (about ten processes at once) now exceed the limit, and opening the new dpp broker to the public would add more traffic. Worse, a failed osu! call returns `null`, which the routes report as `404 Beatmap not found`. A rate-limited lookup is indistinguishable from a beatmap that does not exist, so recalculations silently record wrong results.

This is a targeted fix. A rewrite of the service in the style of the dpp backend is planned separately and is out of scope.

## Goals

- Stay within osu!'s limits under normal traffic and during recalculations, with budgets that can be tuned once the real limits are known.
- Never report a rate-limited or failed osu! lookup as "not found".
- Keep the game, the bot, and the websites responsive while a recalculation runs: bulk traffic must never starve them.
- No caller waits longer than it can afford; when the budget is exhausted, callers get a fast `503` with `Retry-After`.
- Spend no budget on hidden retries, duplicate concurrent fetches, or optional status re-checks.

## Non-goals

- Moving to osu! API v2.
- Rewriting the service (planned separately).
- Coordinating several beatmap service processes: it runs as one process, so in-memory buckets are correct.
- Changes to the dpp processor's code (only its configured key changes).

## Rate limiting

### Budgets

Three token buckets, refilled continuously (a bucket of N per minute gains one token every 60/N seconds, up to N tokens):

| Variable | Default | Applies to |
| --- | --- | --- |
| `OSU_API_RATE_LIMIT` | 55 per minute | `get_beatmaps` calls |
| `OSU_FILE_RATE_LIMIT` | 55 per minute | `.osu` downloads |
| `OSU_TOTAL_RATE_LIMIT` | 55 per minute | every osu! request (the per-IP ceiling) |

Every osu! request takes one token from its kind's bucket and one from the total bucket. The defaults assume the worst case (one shared budget of 60, with a margin). If downloads turn out to be counted separately, raising `OSU_TOTAL_RATE_LIMIT` to 110 doubles throughput without code changes.

Bucket capacity equals the per-minute rate, so a burst of up to that many requests after an idle period is allowed. Set capacity lower if osu! turns out to enforce a shorter window.

### Lanes

| Key | Lane | Callers |
| --- | --- | --- |
| `INTERNAL_SERVER_KEY` (existing) | priority | the game, the bot, websites, everything that uses the key today |
| `BULK_SERVER_KEY` (new) | bulk | the dpp processors, the old dpp backend's recalculation, `populateCache.ts` |

- Both keys are accepted by every route, in the existing `key` query parameter. An unknown key is still `401`.
- Priority requests are always served before bulk requests.
- The bulk lane may use at most `BULK_SHARE` (default `0.5`) of each bucket's rate. It has its own token buckets at that share of each rate; a bulk request needs a token from the bulk buckets and from the shared buckets. Idle priority capacity is not lent to bulk, so the game always has headroom.
- Each request's lane is decided by the key it presented and passed explicitly to the storage functions.

### Waiting and refusing

- A request that finds no token waits in its lane's queue, served in arrival order.
- The limiter estimates the wait from the bucket refill times and the queue ahead of the request. If the estimate exceeds the lane's limit, the request is refused at once with `OsuUnavailableError` (`503`, `Retry-After` = the estimated wait in whole seconds, at least 1):

| Variable | Default |
| --- | --- |
| `PRIORITY_MAX_WAIT_MS` | 8000 |
| `BULK_MAX_WAIT_MS` | 5000 |

  Both are below the dpp processor's 10-second beatmap service timeout, so a refused request reaches the processor as a `503` (which it already maps to `BEATMAP_SERVICE_UNAVAILABLE`) rather than a timeout.

### `429` from osu!

- The service never retries a `429`.
- Every bucket is paused until the response's `Retry-After` (seconds), or 60 seconds if it has none. While paused, requests are refused or queued by the same wait estimate, which now includes the pause.
- The request that got the `429` fails with `OsuUnavailableError` and that `Retry-After`.
- The pause is logged once per `429`.

## osu! gateway

`src/osu/OsuGateway.ts` is the only code that calls osu!. The service no longer uses osu-base's `OsuAPIRequestBuilder` or `MapInfo.getInformation` for requests (both retry internally, spending budget the limiter cannot see). osu-base's `MapInfo.from` and its types are still used to convert responses, so stored data is unchanged.

| Operation | osu! request | Result |
| --- | --- | --- |
| `getBeatmap(lane, idOrHash)` | `GET {OSU_API_BASE_URL}/get_beatmaps?k=…&b=…` or `&h=…` | the first osu!standard beatmap, or `null` if osu! returns none |
| `getBeatmapset(lane, id)` | `GET {OSU_API_BASE_URL}/get_beatmaps?k=…&s=…` | the beatmaps, or `null` if none |
| `downloadFile(lane, id)` | `GET {OSU_FILE_BASE_URL}/{id}` | the file bytes, or `null` on 404 |
| `tryGetBeatmapNow(lane, idOrHash)` | as `getBeatmap` | `undefined` without a request if no token is free immediately in that lane; used only for optional status re-checks |

- `OSU_API_BASE_URL` defaults to `https://osu.ppy.sh/api`, `OSU_FILE_BASE_URL` to `https://osu.ppy.sh/osu`. They exist so tests can point the gateway at a stub server.
- Each operation is exactly one osu! request through the limiter. Any status other than `200` (and other than `404` for downloads), a network error, an unparsable body, or a `429` becomes `OsuUnavailableError`. Only an empty result (or a download `404`) is "not found".
- Requests time out after 10 seconds and become `OsuUnavailableError`.
- Concurrent calls in the same lane for the same operation and argument share one in-flight request and its result. Calls in different lanes do not share, so a priority request never waits in the bulk queue.
- The API key is never logged; URLs in logs have the `k` parameter redacted.

## Changes to existing code

- `src/utils/beatmap/beatmapService.ts`: reimplemented on the gateway.
- `src/utils/beatmap/beatmapStorage.ts`:
  - `getBeatmap`, `getBeatmapset`, and `getBeatmapFile` take a `lane` and use the gateway.
  - `OsuUnavailableError` propagates; only a genuine "not found" returns `null`.
  - The 15-minute status re-check of unranked beatmaps uses `tryGetBeatmapNow`. If no token is free, the cached beatmap is served unchanged and `last_checked` is not updated, so a later request tries again. If the re-check request itself fails, the cached beatmap is served (today it returns `null`, which becomes a `404`).
- `src/utils/security.ts`: accepts either key and records the lane for the request (`res.locals.lane`).
- `src/index.ts`: loads and validates the new configuration at startup (zod; invalid values stop the process with a message naming the variable), and adds an error middleware: `OsuUnavailableError` becomes `503` with `Retry-After` and `{ "error": "osu! is temporarily unavailable; retry later" }`. Other unexpected errors keep their current behavior.
- `src/routes/*.ts`: pass `res.locals.lane` to the storage functions. Responses are otherwise unchanged.
- `src/populateCache.ts`: uses the gateway on the bulk lane and drops its fixed sleep (the limiter paces it).

## Responses

| Situation | Before | After |
| --- | --- | --- |
| beatmap, beatmapset, or file exists | `200` | `200` (unchanged) |
| osu! has no such beatmap / beatmapset / file | `404` | `404` (unchanged) |
| rate-limited (our buckets, or a `429` from osu!) | `404` | `503` + `Retry-After` |
| osu! error, timeout, or network failure | `404` | `503` + `Retry-After` |
| missing or unknown key | `401` | `401` (unchanged) |

The body keeps the `{ error }` shape. Callers that only check for `200` are unaffected; callers that treat `404` specially now see `503` where osu! was unavailable. **Before deploying, check how the osu!droid game handles a `503` from this service.**

## Testing

The repository has no tests. This change adds vitest (`pnpm test`) and a `typecheck` script, and tests the new logic:

- **`TokenBucket`** (fake clock): continuous refill at the configured rate, capacity, `pause`, time until the next token.
- **`RateLimiter`** (fake clock):
  - the kind and total buckets are both charged;
  - priority is served before bulk;
  - bulk is capped at `BULK_SHARE`, and idle priority capacity is not lent to bulk;
  - wait estimation and immediate refusal past the lane's limit, with the right `Retry-After`;
  - a `429` pause delays and refuses requests as expected;
  - `tryNow` never queues.
- **`OsuGateway`**, against a local stub HTTP server:
  - parameters and the key are sent, and the key is redacted in logs;
  - a `429` pauses the limiter and fails with `Retry-After`;
  - `5xx`, a timeout, and an invalid body fail as unavailable;
  - an empty result and a download `404` mean not found;
  - concurrent calls in one lane share one request; calls in different lanes do not;
  - exactly one request per operation, with no hidden retries.
- **Error middleware:** `OsuUnavailableError` becomes `503`, `Retry-After`, and the `{ error }` body.
- **Config:** defaults, overrides, and invalid values rejected without echoing secrets.

Storage and route code that needs Postgres is not covered; adding a database test setup belongs to the planned rewrite.

## Rollout

1. Check the osu!droid game's handling of `503`. Deploy the beatmap service. Existing callers keep `INTERNAL_SERVER_KEY` and the priority lane.
2. Generate `BULK_SERVER_KEY` and set it as `BEATMAP_SERVICE_KEY` on every dpp processor, and as the old dpp backend's beatmap service key while it still runs recalculations.
3. Then open the dpp broker to the public. The dpp score service treats `BEATMAP_SERVICE_UNAVAILABLE` as "retry later" and paces its recalculation to the bulk budget.
