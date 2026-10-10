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
- Coordinating several beatmap service processes: it runs as one process, so in-memory queues are correct.
- Changes to the dpp processor's code (only its configured key changes).
- Removing the built-in retries from osu-base's `OsuAPIRequestBuilder` (retrying is outside a request builder's job). That is a follow-up in `osu-droid-module`; this service simply stops using the builder for requests.

## Rate limiting

### Budgets

Outgoing requests to osu! are paced with [`p-queue`](https://github.com/sindresorhus/p-queue). Each budget is a queue that starts at most one task every `60 / N` seconds (`interval = 60000 / N` ms, `intervalCap = 1`). That gives a smooth N per minute with no bursts, which is safe whether osu! counts in fixed or sliding windows.

| Variable | Default | Queue | Applies to |
| --- | --- | --- | --- |
| `OSU_API_RATE_LIMIT` | 55 per minute | API queue | `get_beatmaps` calls |
| `OSU_FILE_RATE_LIMIT` | 55 per minute | file queue | `.osu` downloads |
| `OSU_TOTAL_RATE_LIMIT` | 55 per minute | total queue | every osu! request (the per-IP ceiling) |

Every osu! request passes through its kind's queue and then the total queue: the kind queue's task adds the request to the total queue, and only the total queue's task performs the HTTP call. Each queue therefore caps the rate of calls through it. The defaults assume the worst case (one shared budget of 60, with a margin). If downloads turn out to be counted separately, raising `OSU_TOTAL_RATE_LIMIT` to 110 doubles throughput without code changes.

### Lanes

| Key | Lane | Callers |
| --- | --- | --- |
| `INTERNAL_SERVER_KEY` (existing) | priority | the game (`pp-processor-node`), the bot, websites, everything that uses the key today |
| `BULK_SERVER_KEY` (new) | bulk | the dpp processors, the old dpp backend's recalculation, `populateCache.ts` |

- Both keys are accepted by every route, in the existing `key` query parameter. An unknown key is still `401`.
- Priority requests are added to every queue with p-queue priority `1`, bulk requests with `0`, so a priority request is started before any waiting bulk request.
- The bulk lane may use at most `BULK_SHARE` (default `0.5`) of each budget. Bulk requests first pass through a bulk API or bulk file queue paced at `BULK_SHARE × OSU_API_RATE_LIMIT` (or the file rate) and at most that share of the total rate (the lower of the two). Idle priority capacity is not lent to bulk, so the game always has headroom.
- Each request's lane is decided by the key it presented and passed explicitly to the storage functions.

### Waiting and refusing

- A request waits in its queues, in priority order and otherwise in arrival order.
- Before queueing, the limiter estimates the wait: for each queue on the request's path, (the number of waiting tasks it would not overtake + 1) × that queue's interval, taking the largest, plus any remaining `429` pause. A priority request only waits behind priority tasks (`sizeBy({ priority: 1 })`); a bulk request waits behind everything. If the estimate exceeds the lane's limit, the request is refused at once with `OsuUnavailableError` (`503`, `Retry-After` = the estimated wait in whole seconds, at least 1):

| Variable | Default |
| --- | --- |
| `PRIORITY_MAX_WAIT_MS` | 8000 |
| `BULK_MAX_WAIT_MS` | 5000 |

  Both are below the dpp processor's 10-second beatmap service timeout, so a refused request reaches the processor as a `503` (which it already maps to `BEATMAP_SERVICE_UNAVAILABLE`) rather than a timeout. The estimate is approximate (later priority arrivals can overtake a waiting bulk request); a bulk request that ends up waiting longer is still served, and the processor's own timeout bounds it.

### `429` from osu!

- The service never retries a `429`.
- Every queue is paused (`pause()`) until the response's `Retry-After` (seconds), or 60 seconds if it has none, then resumed (`start()`). While paused, the wait estimate includes the remaining pause, so most requests are refused with that `Retry-After` instead of queueing.
- The request that got the `429` fails with `OsuUnavailableError` and that `Retry-After`.
- The pause is logged once per `429`.

### Optional work

The 15-minute status re-check of unranked beatmaps is optional. It runs only when every queue on its path is idle (no waiting and no running tasks); otherwise it is skipped. A skipped or failed re-check never delays or fails the request.

## osu! gateway

`src/osu/OsuGateway.ts` is the only code that calls osu!. The service no longer uses osu-base's `OsuAPIRequestBuilder` or `MapInfo.getInformation` for requests (both retry internally, spending budget the limiter cannot see). osu-base's `MapInfo.from` and its types are still used to convert responses, so stored data is unchanged.

| Operation | osu! request | Result |
| --- | --- | --- |
| `getBeatmap(lane, idOrHash)` | `GET {OSU_API_BASE_URL}/get_beatmaps?k=…&b=…` or `&h=…` | the first osu!standard beatmap, or `null` if osu! returns none |
| `getBeatmapset(lane, id)` | `GET {OSU_API_BASE_URL}/get_beatmaps?k=…&s=…` | the beatmaps, or `null` if none |
| `downloadFile(lane, id)` | `GET {OSU_FILE_BASE_URL}/{id}` | the file bytes, or `null` on 404 |
| `tryGetBeatmapNow(lane, idOrHash)` | as `getBeatmap` | `undefined` without a request unless every queue on the lane's path is idle; used only for optional status re-checks |

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
  - The 15-minute status re-check of unranked beatmaps uses `tryGetBeatmapNow`. If the queues are busy, the cached beatmap is served unchanged and `last_checked` is not updated, so a later request tries again. If the re-check request itself fails, the cached beatmap is served (today it returns `null`, which becomes a `404`).
- `src/utils/security.ts`: accepts either key and records the lane for the request (`res.locals.lane`).
- `src/index.ts`: loads and validates the new configuration at startup (zod; invalid values stop the process with a message naming the variable), and adds an error middleware: `OsuUnavailableError` becomes `503` with `Retry-After` and `{ "error": "osu! is temporarily unavailable; retry later" }`. Other unexpected errors keep their current behavior.
- `src/routes/*.ts`: pass `res.locals.lane` to the storage functions. Responses are otherwise unchanged.
- `src/populateCache.ts`: uses the gateway on the bulk lane and drops its fixed sleep (the limiter paces it).

## Responses

| Situation | Before | After |
| --- | --- | --- |
| beatmap, beatmapset, or file exists | `200` | `200` (unchanged) |
| osu! has no such beatmap / beatmapset / file | `404` | `404` (unchanged) |
| rate-limited (our queues, or a `429` from osu!) | `404` | `503` + `Retry-After` |
| osu! error, timeout, or network failure | `404` | `503` + `Retry-After` |
| missing or unknown key | `401` | `401` (unchanged) |

The body keeps the `{ error }` shape. Callers that only check for `200` are unaffected; callers that treat `404` specially now see `503` where osu! was unavailable. `pp-processor-node`, the game's pp processor, already handles a `503` the same way as other failures (see Rollout).

## Testing

The repository has no tests. This change adds vitest (`pnpm test`) and a `typecheck` script, and tests the new logic:

- **`RateLimiter`** (vitest fake timers, which drive p-queue's intervals):
  - calls through a kind queue and the total queue are paced at the lower of the two rates;
  - API and file calls together never exceed the total rate;
  - priority is started before waiting bulk;
  - bulk is capped at `BULK_SHARE`, and idle priority capacity is not lent to bulk;
  - wait estimation and immediate refusal past the lane's limit, with the right `Retry-After`;
  - a `429` pause stops all queues for `Retry-After` and requests during it are refused with the remaining time;
  - `tryNow` runs only when its queues are idle and never queues otherwise.
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

## ES modules

`p-queue` 9 is ESM-only, so the service switches from CommonJS to ES modules first, as a separate, behavior-neutral change:

- `package.json`: `"type": "module"`.
- `tsconfig.json`: `"module": "nodenext"` (module resolution follows).
- Every relative import gets its `.js` extension (26 imports today), and directory imports name their file (`../database` becomes `../database/index.js`).

A probe on a copy of the repository (Node 24.21, TypeScript 5.9.3) confirmed this compiles with no other changes, `dist/index.js` starts and listens, and `p-queue` 9 works (intervals, priority, `sizeBy`). The `start` script (`node --trace-warnings .`) and `main` (`dist/index.js`) keep working. Imports are evaluated before `dotenv`'s `config()` runs, exactly as with the current compiled `require` calls, so environment loading behaves as before.

## Rollout

1. Deploy the beatmap service. `pp-processor-node` (the game's pp processor) already treats any non-OK response other than `404` as "cannot get the beatmap" (logged, then `null`), so a `503` behaves like today's failures, now with an accurate log message. It does not retry; retrying belongs to its later move onto the dpp broker and score service. Existing callers keep `INTERNAL_SERVER_KEY` and the priority lane.
2. Generate `BULK_SERVER_KEY` and set it as `BEATMAP_SERVICE_KEY` on every dpp processor, and as the old dpp backend's beatmap service key while it still runs recalculations.
3. Then open the dpp broker to the public. The dpp score service treats `BEATMAP_SERVICE_UNAVAILABLE` as "retry later" and paces its recalculation to the bulk budget.
