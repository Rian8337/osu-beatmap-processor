# osu! Rate Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the beatmap processor within osu!'s 60-per-minute limits with a two-lane outgoing limiter, report rate-limited or failed osu! lookups as `503` + `Retry-After` instead of `404`, and stop hidden retries and duplicate fetches.

**Architecture:** The service first switches to ES modules (for `p-queue` 9). A `RateLimiter` composes paced `p-queue` queues (API, file, total, and bulk-share queues) with lane priorities, a wait estimate that refuses early, and a pause on osu!'s `429`. An `OsuGateway` is the only code that calls osu!: one request per operation through the limiter, no retries, in-flight sharing per lane. Storage, routes, and the populate script use the gateway, passing the lane chosen by the caller's key; an error middleware turns `OsuUnavailableError` into `503`.

**Tech Stack:** Node.js 24, pnpm, TypeScript 5.9 (`module: nodenext`, ESM), Express 4, `express-async-handler`, `p-queue` 9, zod 3, Drizzle ORM 0.41 + node-postgres, `@rian8337/osu-base` 4.0.0-beta.96 (types and `MapInfo.from` only), vitest, supertest.

**Spec:** `docs/superpowers/specs/2026-10-10-osu-rate-limits-design.md` (read it alongside this plan).

## Global Constraints

- Work on branch `osu-rate-limits`. Before any git command that depends on the current commit, run `git status` and `git log --oneline -1`; the user may run git concurrently. Never use `git reset HEAD~n`; use explicit hashes.
- Commit messages: a short imperative sentence, then a blank line and the `Co-Authored-By:` attribution line your environment gives you.
- Formatting: Prettier with the repository's `.prettierrc.cjs` (4-space indent). Lint: ESLint with the existing `.eslintrc.cjs`, run as `ESLINT_USE_FLAT_CONFIG=false` (ESLint 9 with an eslintrc file).
- Relative imports use `.js` extensions (ESM, `module: nodenext`).
- Defaults, exactly: `OSU_API_RATE_LIMIT` 55, `OSU_FILE_RATE_LIMIT` 55, `OSU_TOTAL_RATE_LIMIT` 55 (per minute), `BULK_SHARE` 0.5, `PRIORITY_MAX_WAIT_MS` 8000, `BULK_MAX_WAIT_MS` 5000, `OSU_API_BASE_URL` `https://osu.ppy.sh/api`, `OSU_FILE_BASE_URL` `https://osu.ppy.sh/osu`, osu! request timeout 10 000 ms, `Retry-After` fallback for a `429` without the header: 60 seconds.
- Lanes: `INTERNAL_SERVER_KEY` → `priority` (p-queue priority `1`); `BULK_SERVER_KEY` → `bulk` (priority `0`). If `INTERNAL_SERVER_KEY` is unset, any key (or none) gets the priority lane, as today.
- The 503 body is exactly `{ "error": "osu! is temporarily unavailable; retry later" }`, with `Retry-After` in whole seconds, at least 1.
- Never log the osu! API key: redact the `k` query parameter in any logged URL.
- No hidden retries: each gateway operation sends exactly one osu! request.
- Do not add new uses of osu-base's `OsuAPIRequestBuilder` or `MapInfo.getInformation`.
- No type assertions (`as`) unless a comment explains why; `as const` is fine.
- Verification at the end of every task: `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm format:check` all pass.

## Review Focus

1. **A beatmap that osu! says does not exist must still be `404`.** Only failures become `503`. An empty `get_beatmaps` result (or a file `404`) is "not found". Tests in Task 4 (gateway) and Task 5 (route mapping).
2. **The optional status re-check must never turn a cached beatmap into an error.** A busy limiter or a failed re-check serves the cached beatmap unchanged; only "osu! no longer has it" behaves as before (not found). Test in Task 5.
3. **A priority caller must never wait behind bulk.** Priority starts before waiting bulk on every shared queue, and in-flight sharing never crosses lanes. Tests in Task 3 and Task 4.
4. **A `429` from osu! must stop everyone, not just the caller.** All queues pause for `Retry-After`; requests during the pause get `503` with the remaining time. Tests in Task 3 and Task 4.
5. **An unknown key stays `401`; the bulk key works on every route.** Test in Task 5.

---

### Task 1: ES modules and test tooling

Behavior-neutral: switch to ESM, add vitest and verification scripts, and fix the five existing lint errors.

**Files:**

- Modify: `package.json`, `tsconfig.json`, `pnpm-lock.yaml`, every `src/**/*.ts` with relative imports
- Modify: `src/database/schema/DatabaseBeatmap.ts`, `src/routes/getbeatmapfile.ts`, `src/utils/beatmap/beatmapStorage.ts` (lint fixes)
- Create: `tsconfig.typecheck.json`, `vitest.config.ts`, `tests/utils/util.test.ts`

**Interfaces:**

- Produces: scripts `typecheck`, `test`, `lint`, `format:check`; ESM layout used by every later task.

- [ ] **Step 1: Check the repository state**

```bash
cd ~/Projects/osu-beatmap-processor
git status
git log --oneline -1
```

Expected: clean tree on `osu-rate-limits`.

- [ ] **Step 2: Switch to ES modules**

In `package.json`, add `"type": "module",` after `"main"`, and replace `"scripts"` with:

```json
  "scripts": {
    "build": "tsc",
    "build-windows": "rmdir dist /s /q & pnpm build",
    "build-linux": "rm -rf dist & pnpm build",
    "start": "node --trace-warnings .",
    "typecheck": "tsc -p tsconfig.typecheck.json",
    "test": "vitest run",
    "lint": "ESLINT_USE_FLAT_CONFIG=false eslint src tests",
    "format:check": "prettier --check src tests"
  },
```

In `tsconfig.json`, change `"module": "commonjs"` to `"module": "nodenext"`.

Add the `.js` extension to every relative import (directory imports name their `index.js`). Run this from the repository root:

```bash
python3 - <<'EOF'
import re, pathlib
for f in pathlib.Path("src").rglob("*.ts"):
    s = f.read_text()
    def fix(m):
        path = m.group(2)
        target = f.parent / path
        if target.with_suffix(".ts").exists():
            return f"{m.group(1)}{path}.js{m.group(3)}"
        if (target / "index.ts").exists():
            return f"{m.group(1)}{path}/index.js{m.group(3)}"
        return m.group(0)
    new = re.sub(r'(from ")(\.\.?/[^"]+?)(")', fix, s)
    if new != s:
        f.write_text(new)
EOF
```

Expected: 26 imports changed (`git diff --stat` lists the files under `src/`).

- [ ] **Step 3: Fix the existing lint errors**

- `src/database/schema/DatabaseBeatmap.ts`: remove the unused `BeatmapGenre`, `BeatmapLanguage`, `RankedStatus` import (the whole `import { … } from "@rian8337/osu-base";` statement).
- `src/utils/beatmap/beatmapStorage.ts`: remove the unused `import { homedir } from "os";`.
- `src/routes/getbeatmapfile.ts`: change `if (beatmap && beatmap.max_combo === null) {` to `if (beatmap?.max_combo === null) {`.

- [ ] **Step 4: Add the test and typecheck tooling**

```bash
pnpm add -D vitest@^5 supertest @types/supertest
pnpm add p-queue@^9.3.3
```

If pnpm rejects a version because of a minimum release age, use the newest version it accepts.

`tsconfig.typecheck.json`:

```json
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "noEmit": true,
        "rootDir": "."
    },
    "include": ["src", "tests", "vitest.config.ts"]
}
```

In `.eslintrc.cjs`, change `project: "tsconfig.json"` to `project: "tsconfig.typecheck.json"` so ESLint can type-check the tests.

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        restoreMocks: true,
    },
});
```

`tests/utils/util.test.ts` (proves the toolchain runs ESM source):

```ts
import { describe, expect, it } from "vitest";
import { computeMD5 } from "../../src/utils/util.js";

describe("computeMD5", () => {
    it("hashes bytes as lowercase hex", () => {
        expect(computeMD5(Buffer.from("abc"))).toBe(
            "900150983cd24fb0d6963f7d28e17f72",
        );
    });
});
```

- [ ] **Step 5: Verify the build still runs**

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm format:check
rm -rf dist && pnpm build
EXPRESS_PORT=39123 timeout 4 node dist/index.js; echo "exit $?"
```

Expected: all checks pass; the server prints `Server is running on port 39123` and `timeout` ends it (exit 124 is fine). Do not leave a server running.

- [ ] **Step 6: Commit**

```bash
git status
git add -A package.json pnpm-lock.yaml tsconfig.json tsconfig.typecheck.json vitest.config.ts .eslintrc.cjs src tests
git commit -m "Switch to ES modules and add test tooling

<attribution line>"
```

---

### Task 2: Configuration and errors

**Files:**

- Create: `src/config.ts`, `src/osu/errors.ts`, `tests/config.test.ts`

**Interfaces:**

- Produces:

```ts
// src/osu/errors.ts
export type Lane = "priority" | "bulk";
export type RequestKind = "api" | "file";
export const unavailableMessage = "osu! is temporarily unavailable; retry later";
export class OsuUnavailableError extends Error {
    constructor(readonly retryAfterSeconds: number);
}

// src/config.ts
export interface Config {
    readonly osuApiKey: string;
    readonly internalServerKey: string | undefined;
    readonly bulkServerKey: string | undefined;
    readonly ratesPerMinute: { readonly api: number; readonly file: number; readonly total: number };
    readonly bulkShare: number;
    readonly maxWaitMs: { readonly priority: number; readonly bulk: number };
    readonly osuApiBaseUrl: string;
    readonly osuFileBaseUrl: string;
}
export class ConfigError extends Error {}
export function loadConfig(env: NodeJS.ProcessEnv): Config;
export function getConfig(): Config; // loadConfig(process.env), cached
```

- [ ] **Step 1: Write the failing tests**

`tests/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
    it("applies defaults", () => {
        expect(loadConfig({ OSU_API_KEY: "osu-key" })).toEqual({
            osuApiKey: "osu-key",
            internalServerKey: undefined,
            bulkServerKey: undefined,
            ratesPerMinute: { api: 55, file: 55, total: 55 },
            bulkShare: 0.5,
            maxWaitMs: { priority: 8000, bulk: 5000 },
            osuApiBaseUrl: "https://osu.ppy.sh/api",
            osuFileBaseUrl: "https://osu.ppy.sh/osu",
        });
    });

    it("reads every variable and strips trailing slashes from base URLs", () => {
        const config = loadConfig({
            OSU_API_KEY: "osu-key",
            INTERNAL_SERVER_KEY: "internal",
            BULK_SERVER_KEY: "bulk",
            OSU_API_RATE_LIMIT: "50",
            OSU_FILE_RATE_LIMIT: "40",
            OSU_TOTAL_RATE_LIMIT: "110",
            BULK_SHARE: "0.25",
            PRIORITY_MAX_WAIT_MS: "9000",
            BULK_MAX_WAIT_MS: "3000",
            OSU_API_BASE_URL: "http://127.0.0.1:1234/api/",
            OSU_FILE_BASE_URL: "http://127.0.0.1:1234/osu/",
        });

        expect(config).toMatchObject({
            internalServerKey: "internal",
            bulkServerKey: "bulk",
            ratesPerMinute: { api: 50, file: 40, total: 110 },
            bulkShare: 0.25,
            maxWaitMs: { priority: 9000, bulk: 3000 },
            osuApiBaseUrl: "http://127.0.0.1:1234/api",
            osuFileBaseUrl: "http://127.0.0.1:1234/osu",
        });
    });

    it("treats empty variables as unset", () => {
        expect(
            loadConfig({ OSU_API_KEY: "osu-key", BULK_SERVER_KEY: "" })
                .bulkServerKey,
        ).toBeUndefined();
    });

    it("names invalid variables without echoing secrets", () => {
        const attempt = () =>
            loadConfig({
                OSU_API_RATE_LIMIT: "0",
                BULK_SHARE: "1.5",
                INTERNAL_SERVER_KEY: "secret-value",
                BULK_SERVER_KEY: "secret-value",
            });

        expect(attempt).toThrow(ConfigError);
        expect(attempt).toThrow(/OSU_API_KEY/);
        expect(attempt).toThrow(/OSU_API_RATE_LIMIT/);
        expect(attempt).toThrow(/BULK_SHARE/);
        expect(attempt).not.toThrow(/secret-value/);
    });

    it("rejects using the same key for both lanes", () => {
        expect(() =>
            loadConfig({
                OSU_API_KEY: "osu-key",
                INTERNAL_SERVER_KEY: "same",
                BULK_SERVER_KEY: "same",
            }),
        ).toThrow(/BULK_SERVER_KEY must differ from INTERNAL_SERVER_KEY/);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run tests/config.test.ts`
Expected: FAIL, cannot resolve `../src/config.js`.

- [ ] **Step 3: Implement**

`src/osu/errors.ts`:

```ts
/**
 * Which queue lane a request uses: `priority` for the game and other interactive callers, `bulk` for
 * recalculations and other mass traffic.
 */
export type Lane = "priority" | "bulk";

/**
 * Which osu! budget a request spends: `get_beatmaps` calls or `.osu` downloads.
 */
export type RequestKind = "api" | "file";

export const unavailableMessage =
    "osu! is temporarily unavailable; retry later";

/**
 * osu! could not be asked right now: our budget is exhausted, osu! answered `429`, or the request failed.
 * Never means "not found".
 */
export class OsuUnavailableError extends Error {
    readonly retryAfterSeconds: number;

    constructor(retryAfterSeconds: number) {
        super(unavailableMessage);
        this.name = "OsuUnavailableError";
        this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
    }
}
```

`src/config.ts`:

```ts
import { z } from "zod";

/**
 * Settings read from environment variables.
 */
export interface Config {
    readonly osuApiKey: string;

    /**
     * Key for the priority lane. When unset, any request gets the priority lane (as before this change).
     */
    readonly internalServerKey: string | undefined;

    /**
     * Key for the bulk lane.
     */
    readonly bulkServerKey: string | undefined;
    readonly ratesPerMinute: {
        readonly api: number;
        readonly file: number;
        readonly total: number;
    };

    /**
     * The fraction of each budget the bulk lane may use, in (0, 1].
     */
    readonly bulkShare: number;
    readonly maxWaitMs: { readonly priority: number; readonly bulk: number };
    readonly osuApiBaseUrl: string;
    readonly osuFileBaseUrl: string;
}

/**
 * Thrown for missing or invalid environment variables. Names the variables, never their values.
 */
export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConfigError";
    }
}

const perMinute = z.coerce.number().int().min(1);
const milliseconds = z.coerce.number().int().min(0);
const baseUrl = z
    .string()
    .url()
    .transform((url) => url.replace(/\/+$/, ""));

const schema = z
    .object({
        OSU_API_KEY: z.string().min(1),
        INTERNAL_SERVER_KEY: z.string().optional(),
        BULK_SERVER_KEY: z.string().optional(),
        OSU_API_RATE_LIMIT: perMinute.default(55),
        OSU_FILE_RATE_LIMIT: perMinute.default(55),
        OSU_TOTAL_RATE_LIMIT: perMinute.default(55),
        BULK_SHARE: z.coerce.number().gt(0).lte(1).default(0.5),
        PRIORITY_MAX_WAIT_MS: milliseconds.default(8000),
        BULK_MAX_WAIT_MS: milliseconds.default(5000),
        OSU_API_BASE_URL: baseUrl.default("https://osu.ppy.sh/api"),
        OSU_FILE_BASE_URL: baseUrl.default("https://osu.ppy.sh/osu"),
    })
    .refine(
        (values) =>
            values.BULK_SERVER_KEY === undefined ||
            values.BULK_SERVER_KEY !== values.INTERNAL_SERVER_KEY,
        {
            message: "BULK_SERVER_KEY must differ from INTERNAL_SERVER_KEY",
            path: ["BULK_SERVER_KEY"],
        },
    );

/**
 * Reads and validates the configuration. Empty variables count as unset.
 *
 * @throws {ConfigError} If any variable is missing or invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
    const present = Object.fromEntries(
        Object.entries(env).filter(([, value]) => value !== ""),
    );
    const result = schema.safeParse(present);

    if (!result.success) {
        const problems = result.error.issues.map((issue) =>
            issue.path.length > 0
                ? `${issue.path.join(".")}: ${issue.message}`
                : issue.message,
        );

        throw new ConfigError(
            `Invalid configuration:\n  ${problems.join("\n  ")}`,
        );
    }

    const values = result.data;

    return {
        osuApiKey: values.OSU_API_KEY,
        internalServerKey: values.INTERNAL_SERVER_KEY,
        bulkServerKey: values.BULK_SERVER_KEY,
        ratesPerMinute: {
            api: values.OSU_API_RATE_LIMIT,
            file: values.OSU_FILE_RATE_LIMIT,
            total: values.OSU_TOTAL_RATE_LIMIT,
        },
        bulkShare: values.BULK_SHARE,
        maxWaitMs: {
            priority: values.PRIORITY_MAX_WAIT_MS,
            bulk: values.BULK_MAX_WAIT_MS,
        },
        osuApiBaseUrl: values.OSU_API_BASE_URL,
        osuFileBaseUrl: values.OSU_FILE_BASE_URL,
    };
}

let cached: Config | undefined;

/**
 * The process configuration, loaded from `process.env` on first use.
 */
export function getConfig(): Config {
    cached ??= loadConfig(process.env);

    return cached;
}
```

If the refine message is reported with an issue path that duplicates the variable name in a confusing way, keep the message text exactly as above; the test matches it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm format:check
git status
git add src/config.ts src/osu/errors.ts tests/config.test.ts
git commit -m "Add rate limit configuration and the osu! unavailable error

<attribution line>"
```

---

### Task 3: Rate limiter

**Files:**

- Create: `src/osu/RateLimiter.ts`, `tests/osu/RateLimiter.test.ts`

**Interfaces:**

- Consumes: `Lane`, `RequestKind`, `OsuUnavailableError` (Task 2).
- Produces:

```ts
export interface RateLimiterOptions {
    readonly ratesPerMinute: {
        readonly api: number;
        readonly file: number;
        readonly total: number;
    };
    readonly bulkShare: number;
    readonly maxWaitMs: { readonly priority: number; readonly bulk: number };
}

export class RateLimiter {
    constructor(options: RateLimiterOptions);
    /** Runs `fn` when every queue on the lane's path allows it. @throws {OsuUnavailableError} if the estimated wait exceeds the lane's limit. */
    schedule<T>(
        lane: Lane,
        kind: RequestKind,
        fn: () => Promise<T>,
    ): Promise<T>;
    /** Runs `fn` only if every queue on the path is idle and nothing is paused; otherwise resolves `undefined` without calling it. */
    tryNow<T>(
        lane: Lane,
        kind: RequestKind,
        fn: () => Promise<T>,
    ): Promise<T | undefined>;
    /** Estimated wait in ms for a new request in this lane and kind, including any remaining pause. */
    estimateWaitMs(lane: Lane, kind: RequestKind): number;
    /** Pauses every queue for `ms` (osu! answered 429). A longer pause replaces a shorter one. */
    pauseFor(ms: number): void;
}
```

- Queue path for a request: priority → [kind queue, total queue]; bulk → [bulk kind queue, kind queue, total queue].
- Intervals: kind queue `60000 / ratesPerMinute[kind]` ms; total queue `60000 / total`; bulk kind queue `60000 / (bulkShare × min(ratesPerMinute[kind], total))`. Each queue uses `intervalCap: 1` and is rounded up to whole milliseconds.

- [ ] **Step 1: Write the failing tests**

`tests/osu/RateLimiter.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OsuUnavailableError } from "../../src/osu/errors.js";
import {
    RateLimiter,
    type RateLimiterOptions,
} from "../../src/osu/RateLimiter.js";

const relaxed: RateLimiterOptions = {
    ratesPerMinute: { api: 60, file: 60, total: 60 },
    bulkShare: 0.5,
    maxWaitMs: { priority: 600_000, bulk: 600_000 },
};

/**
 * Schedules a call that records when it started (fake time) and its label.
 */
function recorder() {
    const starts: { label: string; at: number }[] = [];

    return {
        starts,
        task: (label: string) => (): Promise<string> => {
            starts.push({ label, at: Date.now() });

            return Promise.resolve(label);
        },
    };
}

function gaps(starts: { at: number }[]): number[] {
    return starts.slice(1).map((start, i) => start.at - (starts[i]?.at ?? 0));
}

describe("RateLimiter", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-10T00:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("paces calls through a kind queue and the total queue at the lower rate", async () => {
        const limiter = new RateLimiter({
            ...relaxed,
            ratesPerMinute: { api: 60, file: 60, total: 30 },
        });
        const { starts, task } = recorder();
        const done = Promise.all(
            ["a", "b", "c"].map((label) =>
                limiter.schedule("priority", "api", task(label)),
            ),
        );

        await vi.advanceTimersByTimeAsync(10_000);
        await done;

        expect(starts.map((s) => s.label)).toEqual(["a", "b", "c"]);

        for (const gap of gaps(starts)) {
            expect(gap).toBeGreaterThanOrEqual(2000);
        }
    });

    it("keeps API and file calls together under the total rate", async () => {
        const limiter = new RateLimiter({
            ...relaxed,
            ratesPerMinute: { api: 60, file: 60, total: 30 },
        });
        const { starts, task } = recorder();
        const done = Promise.all([
            limiter.schedule("priority", "api", task("api-1")),
            limiter.schedule("priority", "file", task("file-1")),
            limiter.schedule("priority", "api", task("api-2")),
            limiter.schedule("priority", "file", task("file-2")),
        ]);

        await vi.advanceTimersByTimeAsync(20_000);
        await done;

        expect(starts).toHaveLength(4);

        for (const gap of gaps(starts)) {
            expect(gap).toBeGreaterThanOrEqual(2000);
        }
    });

    it("starts a priority call before a bulk call already waiting on a shared queue", async () => {
        // With a full share, the bulk call passes its own queue at once and waits on the shared API queue.
        const limiter = new RateLimiter({ ...relaxed, bulkShare: 1 });
        const { starts, task } = recorder();
        const first = limiter.schedule("priority", "api", task("priority-1"));
        const bulk = limiter.schedule("bulk", "api", task("bulk"));

        // Let the bulk call reach the shared API queue, behind priority-1's interval.
        await vi.advanceTimersByTimeAsync(0);

        const second = limiter.schedule("priority", "api", task("priority-2"));

        await vi.advanceTimersByTimeAsync(10_000);
        await Promise.all([first, bulk, second]);

        // First come, first served would start "bulk" before "priority-2".
        expect(starts.map((s) => s.label)).toEqual([
            "priority-1",
            "priority-2",
            "bulk",
        ]);
    });

    it("caps bulk at its share without lending idle priority capacity", async () => {
        const limiter = new RateLimiter(relaxed);
        const { starts, task } = recorder();
        const done = Promise.all(
            ["1", "2", "3", "4"].map((label) =>
                limiter.schedule("bulk", "api", task(label)),
            ),
        );

        await vi.advanceTimersByTimeAsync(30_000);
        await done;

        // 60 per minute at a 0.5 share is one call every 2 s, even though priority is idle.
        for (const gap of gaps(starts)) {
            expect(gap).toBeGreaterThanOrEqual(2000);
        }
    });

    it("refuses at once when the estimated wait exceeds the lane's limit", async () => {
        const limiter = new RateLimiter({
            ...relaxed,
            maxWaitMs: { priority: 600_000, bulk: 5000 },
        });
        const { task } = recorder();
        const accepted: Promise<string>[] = [];
        let refusal: unknown;

        for (let i = 0; i < 10; i++) {
            try {
                accepted.push(limiter.schedule("bulk", "api", task(String(i))));
            } catch (e) {
                refusal = e;
                break;
            }
        }

        expect(accepted.length).toBeGreaterThanOrEqual(1);
        expect(accepted.length).toBeLessThan(10);
        expect(refusal).toBeInstanceOf(OsuUnavailableError);
        expect(
            refusal instanceof OsuUnavailableError && refusal.retryAfterSeconds,
        ).toBeGreaterThanOrEqual(5);

        await vi.advanceTimersByTimeAsync(60_000);
        await Promise.all(accepted);
    });

    it("estimates a priority wait only from priority calls ahead of it", () => {
        const limiter = new RateLimiter(relaxed);
        const { task } = recorder();

        for (let i = 0; i < 5; i++) {
            void limiter.schedule("bulk", "api", task(`bulk-${String(i)}`));
        }

        expect(limiter.estimateWaitMs("priority", "api")).toBeLessThanOrEqual(
            1000,
        );
        expect(limiter.estimateWaitMs("bulk", "api")).toBeGreaterThan(5000);
    });

    it("pauses every queue after a 429 and refuses with the remaining pause", async () => {
        const limiter = new RateLimiter({
            ...relaxed,
            maxWaitMs: { priority: 8000, bulk: 5000 },
        });
        const { starts, task } = recorder();

        limiter.pauseFor(30_000);

        expect(() =>
            limiter.schedule("priority", "file", task("early")),
        ).toThrow(OsuUnavailableError);

        try {
            await limiter.schedule("priority", "api", task("early"));
        } catch (e) {
            expect(e).toBeInstanceOf(OsuUnavailableError);
            // The remaining pause plus one queue interval.
            const retryAfter =
                e instanceof OsuUnavailableError ? e.retryAfterSeconds : 0;

            expect(retryAfter).toBeGreaterThanOrEqual(30);
            expect(retryAfter).toBeLessThanOrEqual(31);
        }

        await vi.advanceTimersByTimeAsync(30_000);

        const after = limiter.schedule("priority", "api", task("after"));

        await vi.advanceTimersByTimeAsync(2000);

        expect(await after).toBe("after");
        expect(starts.map((s) => s.label)).toEqual(["after"]);
    });

    it("runs optional work only when its queues are idle", async () => {
        const limiter = new RateLimiter(relaxed);
        const optional = vi.fn(() => Promise.resolve("checked"));

        const idle = limiter.tryNow("priority", "api", optional);

        await vi.advanceTimersByTimeAsync(2000);

        expect(await idle).toBe("checked");

        const { task } = recorder();
        const busy = [
            limiter.schedule("priority", "api", task("a")),
            limiter.schedule("priority", "api", task("b")),
        ];

        optional.mockClear();

        expect(
            await limiter.tryNow("priority", "api", optional),
        ).toBeUndefined();
        expect(optional).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(10_000);
        await Promise.all(busy);
    });
});
```

Note: `schedule` throws synchronously when it refuses (it is not `async`), so the refusal loop above can catch it without awaiting. Keep it that way (the gateway relies on it only through `await`, which also catches synchronous throws inside an `async` caller).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run tests/osu/RateLimiter.test.ts`
Expected: FAIL, cannot resolve `../../src/osu/RateLimiter.js`.

- [ ] **Step 3: Implement**

`src/osu/RateLimiter.ts`:

```ts
import PQueue from "p-queue";
import { OsuUnavailableError, type Lane, type RequestKind } from "./errors.js";

export interface RateLimiterOptions {
    readonly ratesPerMinute: {
        readonly api: number;
        readonly file: number;
        readonly total: number;
    };
    readonly bulkShare: number;
    readonly maxWaitMs: { readonly priority: number; readonly bulk: number };
}

const priorityOf: Record<Lane, number> = { priority: 1, bulk: 0 };

interface PacedQueue {
    readonly queue: PQueue;
    readonly intervalMs: number;
}

function paced(perMinute: number): PacedQueue {
    const intervalMs = Math.ceil(60_000 / perMinute);

    return {
        queue: new PQueue({ interval: intervalMs, intervalCap: 1 }),
        intervalMs,
    };
}

/**
 * Paces outgoing osu! requests. Every request passes through its kind's queue and the total queue (and, for the
 * bulk lane, a bulk queue at `bulkShare` of the rate); each queue starts at most one task per interval. Priority
 * tasks start before waiting bulk tasks on every shared queue.
 */
export class RateLimiter {
    private readonly kindQueues: Record<RequestKind, PacedQueue>;
    private readonly bulkQueues: Record<RequestKind, PacedQueue>;
    private readonly totalQueue: PacedQueue;
    private readonly maxWaitMs: RateLimiterOptions["maxWaitMs"];
    private pausedUntil = 0;
    private resumeTimer: NodeJS.Timeout | undefined;

    constructor(options: RateLimiterOptions) {
        const { ratesPerMinute, bulkShare } = options;

        this.kindQueues = {
            api: paced(ratesPerMinute.api),
            file: paced(ratesPerMinute.file),
        };
        this.totalQueue = paced(ratesPerMinute.total);
        this.bulkQueues = {
            api: paced(
                bulkShare * Math.min(ratesPerMinute.api, ratesPerMinute.total),
            ),
            file: paced(
                bulkShare * Math.min(ratesPerMinute.file, ratesPerMinute.total),
            ),
        };
        this.maxWaitMs = options.maxWaitMs;
    }

    schedule<T>(
        lane: Lane,
        kind: RequestKind,
        fn: () => Promise<T>,
    ): Promise<T> {
        const waitMs = this.estimateWaitMs(lane, kind);

        if (waitMs > this.maxWaitMs[lane]) {
            throw new OsuUnavailableError(waitMs / 1000);
        }

        return this.run(this.path(lane, kind), priorityOf[lane], fn);
    }

    tryNow<T>(
        lane: Lane,
        kind: RequestKind,
        fn: () => Promise<T>,
    ): Promise<T | undefined> {
        const path = this.path(lane, kind);
        const idle =
            this.remainingPauseMs() === 0 &&
            path.every(({ queue }) => queue.size === 0 && queue.pending === 0);

        return idle
            ? this.run(path, priorityOf[lane], fn)
            : Promise.resolve(undefined);
    }

    estimateWaitMs(lane: Lane, kind: RequestKind): number {
        const queueWaitMs = Math.max(
            ...this.path(lane, kind).map(({ queue, intervalMs }) => {
                const ahead =
                    lane === "priority"
                        ? queue.sizeBy({ priority: priorityOf.priority })
                        : queue.size;

                return (ahead + 1) * intervalMs;
            }),
        );

        return queueWaitMs + this.remainingPauseMs();
    }

    pauseFor(ms: number): void {
        const until = Date.now() + ms;

        if (until <= this.pausedUntil) {
            return;
        }

        this.pausedUntil = until;

        for (const { queue } of this.allQueues()) {
            queue.pause();
        }

        clearTimeout(this.resumeTimer);
        this.resumeTimer = setTimeout(() => {
            this.resumeTimer = undefined;

            for (const { queue } of this.allQueues()) {
                queue.start();
            }
        }, ms);
        this.resumeTimer.unref();
    }

    private remainingPauseMs(): number {
        return Math.max(0, this.pausedUntil - Date.now());
    }

    private path(lane: Lane, kind: RequestKind): PacedQueue[] {
        const shared = [this.kindQueues[kind], this.totalQueue];

        return lane === "bulk" ? [this.bulkQueues[kind], ...shared] : shared;
    }

    private allQueues(): PacedQueue[] {
        return [
            this.kindQueues.api,
            this.kindQueues.file,
            this.totalQueue,
            this.bulkQueues.api,
            this.bulkQueues.file,
        ];
    }

    private run<T>(
        path: readonly PacedQueue[],
        priority: number,
        fn: () => Promise<T>,
    ): Promise<T> {
        const [first, ...rest] = path;

        if (!first) {
            return fn();
        }

        return first.queue.add(() => this.run(rest, priority, fn), {
            priority,
        });
    }
}
```

If `p-queue`'s `add` return type in the installed version is `Promise<T | void>`, pass `{ priority, throwOnTimeout: true }` (no timeout is set, so it never times out) so the type is `Promise<T>`; do not add an `as` cast.

The first test with `toThrow` on a paused `file` call relies on `schedule` throwing synchronously; the second `try`/`await` covers the `api` path. If `toThrow` fails because the call does not throw synchronously, the implementation is wrong (it must not be `async`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/osu/RateLimiter.test.ts`
Expected: PASS. If a pacing assertion fails by a few milliseconds, check that intervals are rounded up (`Math.ceil`) and that the assertion uses the interval of the slowest queue on the path; do not loosen the test below the configured interval.

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm format:check
git status
git add src/osu/RateLimiter.ts tests/osu/RateLimiter.test.ts
git commit -m "Add the outgoing osu! rate limiter

<attribution line>"
```

---

### Task 4: osu! gateway

**Files:**

- Create: `src/osu/OsuGateway.ts`, `src/osu/index.ts`, `tests/osu/OsuGateway.test.ts`, `tests/utils/stubOsu.ts`

**Interfaces:**

- Consumes: `RateLimiter` (Task 3), `OsuUnavailableError`, `Lane` (Task 2), `Config`, `getConfig` (Task 2), `OsuAPIResponse` (`@rian8337/osu-base`).
- Produces:

```ts
export interface OsuGatewayOptions {
    readonly apiKey: string;
    readonly apiBaseUrl: string;
    readonly fileBaseUrl: string;
    readonly limiter: RateLimiter;
    /** Defaults to 10 000. */
    readonly timeoutMs?: number;
}

export class OsuGateway {
    constructor(options: OsuGatewayOptions);
    /** The first osu!standard beatmap for an ID or MD5 hash, `null` if osu! has none. @throws {OsuUnavailableError} */
    getBeatmap(
        lane: Lane,
        idOrHash: number | string,
    ): Promise<OsuAPIResponse | null>;
    /** Every beatmap of a beatmapset, `null` if osu! has none. @throws {OsuUnavailableError} */
    getBeatmapset(lane: Lane, id: number): Promise<OsuAPIResponse[] | null>;
    /** The `.osu` file, `null` if osu! answers 404 or an empty body. @throws {OsuUnavailableError} */
    downloadFile(lane: Lane, id: number): Promise<Buffer | null>;
    /** Like getBeatmap, but only if the limiter is idle; `undefined` without a request otherwise. @throws {OsuUnavailableError} */
    tryGetBeatmapNow(
        lane: Lane,
        idOrHash: number | string,
    ): Promise<OsuAPIResponse | null | undefined>;
}

// src/osu/index.ts
export function createOsuGateway(config: Config): OsuGateway;
export function getOsuGateway(): OsuGateway; // created from getConfig() on first use
```

- Behavior: `429` → `limiter.pauseFor(retryAfter × 1000)`, one `console.warn` (URL redacted), `OsuUnavailableError(retryAfter)` where `retryAfter` is the `Retry-After` header in seconds or 60. Any other non-`200` (and non-`404` for files), a network error, a timeout, or an unparsable body → `OsuUnavailableError(5)` and one `console.error` (URL redacted). Concurrent calls with the same lane, operation, and argument share one in-flight promise.

- [ ] **Step 1: Write the stub osu! server**

`tests/utils/stubOsu.ts`:

```ts
import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";

export interface StubOsu extends AsyncDisposable {
    /** Base URL without a trailing slash; the API is at `${url}/api`, files at `${url}/osu`. */
    readonly url: string;
    /** Every request path with its query string, in order. */
    readonly requests: string[];
    handle(handler: (req: IncomingMessage, res: ServerResponse) => void): void;
}

export function startStubOsu(): Promise<StubOsu> {
    const requests: string[] = [];
    let handler = (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(500).end();
    };
    const server = createServer((req, res) => {
        requests.push(req.url ?? "");
        handler(req, res);
    });

    return new Promise((resolve, reject) => {
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();

            if (!address || typeof address === "string") {
                reject(new Error("Stub osu! server has no TCP address"));
                return;
            }

            resolve({
                url: `http://127.0.0.1:${address.port.toString()}`,
                requests,
                handle: (next) => {
                    handler = next;
                },
                [Symbol.asyncDispose]: () =>
                    new Promise<void>((done) => {
                        server.closeAllConnections();
                        server.close(() => done());
                    }),
            });
        });
    });
}
```

- [ ] **Step 2: Write the failing tests**

`tests/osu/OsuGateway.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OsuUnavailableError } from "../../src/osu/errors.js";
import { OsuGateway } from "../../src/osu/OsuGateway.js";
import { RateLimiter } from "../../src/osu/RateLimiter.js";
import { startStubOsu, type StubOsu } from "../utils/stubOsu.js";

const apiKey = "secret-osu-key";

function beatmap(id: number, mode = "0") {
    return {
        beatmap_id: id.toString(),
        beatmapset_id: "1",
        file_md5: "0123456789abcdef0123456789abcdef",
        mode,
    };
}

describe("OsuGateway", () => {
    let stub: StubOsu;
    let limiter: RateLimiter;
    let gateway: OsuGateway;

    beforeEach(async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        stub = await startStubOsu();
        // Fast limits so tests do not wait; pacing itself is tested in RateLimiter.test.ts.
        limiter = new RateLimiter({
            ratesPerMinute: { api: 60_000, file: 60_000, total: 60_000 },
            bulkShare: 1,
            maxWaitMs: { priority: 60_000, bulk: 60_000 },
        });
        gateway = new OsuGateway({
            apiKey,
            apiBaseUrl: `${stub.url}/api`,
            fileBaseUrl: `${stub.url}/osu`,
            limiter,
            timeoutMs: 200,
        });
    });

    afterEach(() => stub[Symbol.asyncDispose]());

    const json =
        (body: unknown) =>
        (_req: unknown, res: import("node:http").ServerResponse) => {
            res.writeHead(200, { "Content-Type": "application/json" }).end(
                JSON.stringify(body),
            );
        };

    it("asks get_beatmaps by ID or hash with the key, and returns the osu!standard beatmap", async () => {
        stub.handle(json([beatmap(5)]));

        expect(await gateway.getBeatmap("priority", 5)).toMatchObject({
            beatmap_id: "5",
        });
        expect(
            await gateway.getBeatmap(
                "priority",
                "0123456789abcdef0123456789abcdef",
            ),
        ).toMatchObject({ beatmap_id: "5" });
        expect(stub.requests).toEqual([
            `/api/get_beatmaps?k=${apiKey}&b=5`,
            `/api/get_beatmaps?k=${apiKey}&h=0123456789abcdef0123456789abcdef`,
        ]);
    });

    it("treats an empty result or a non-standard beatmap as not found", async () => {
        stub.handle(json([]));

        expect(await gateway.getBeatmap("priority", 1)).toBeNull();
        expect(await gateway.getBeatmapset("priority", 1)).toBeNull();

        stub.handle(json([beatmap(2, "3")]));

        expect(await gateway.getBeatmap("priority", 2)).toBeNull();
    });

    it("returns every beatmap of a beatmapset", async () => {
        stub.handle(json([beatmap(1), beatmap(2, "1")]));

        expect(await gateway.getBeatmapset("bulk", 9)).toHaveLength(2);
        expect(stub.requests).toEqual([`/api/get_beatmaps?k=${apiKey}&s=9`]);
    });

    it("downloads files, treating 404 and an empty body as not found", async () => {
        stub.handle((req, res) => {
            if (req.url === "/osu/1") {
                res.writeHead(200).end("osu file format v14");
            } else if (req.url === "/osu/2") {
                res.writeHead(200).end();
            } else {
                res.writeHead(404).end();
            }
        });

        expect((await gateway.downloadFile("priority", 1))?.toString()).toBe(
            "osu file format v14",
        );
        expect(await gateway.downloadFile("priority", 2)).toBeNull();
        expect(await gateway.downloadFile("priority", 3)).toBeNull();
    });

    it("pauses the limiter on 429, fails with its Retry-After, and never retries", async () => {
        const pauseFor = vi.spyOn(limiter, "pauseFor");

        stub.handle((_req, res) => {
            res.writeHead(429, { "Retry-After": "42" }).end();
        });

        const attempt = gateway.getBeatmap("priority", 1);

        await expect(attempt).rejects.toBeInstanceOf(OsuUnavailableError);
        await attempt.catch((e: unknown) => {
            expect(
                e instanceof OsuUnavailableError && e.retryAfterSeconds,
            ).toBe(42);
        });
        expect(pauseFor).toHaveBeenCalledWith(42_000);
        expect(stub.requests).toHaveLength(1);
        expect(
            JSON.stringify(vi.mocked(console.warn).mock.calls),
        ).not.toContain(apiKey);
    });

    it("uses 60 seconds when a 429 has no Retry-After", async () => {
        const pauseFor = vi.spyOn(limiter, "pauseFor");

        stub.handle((_req, res) => {
            res.writeHead(429).end();
        });

        await expect(gateway.downloadFile("bulk", 1)).rejects.toMatchObject({
            retryAfterSeconds: 60,
        });
        expect(pauseFor).toHaveBeenCalledWith(60_000);
    });

    it.each([
        [
            "a 5xx",
            (res: import("node:http").ServerResponse) =>
                res.writeHead(502).end(),
        ],
        [
            "an unparsable body",
            (res: import("node:http").ServerResponse) =>
                res
                    .writeHead(200, { "Content-Type": "application/json" })
                    .end("{"),
        ],
        [
            "a non-array body",
            (res: import("node:http").ServerResponse) =>
                res
                    .writeHead(200, { "Content-Type": "application/json" })
                    .end(
                        JSON.stringify({
                            error: "Please provide a valid API key.",
                        }),
                    ),
        ],
    ])(
        "fails as unavailable on %s, once, without leaking the key",
        async (_case, reply) => {
            stub.handle((_req, res) => {
                reply(res);
            });

            await expect(
                gateway.getBeatmap("priority", 1),
            ).rejects.toBeInstanceOf(OsuUnavailableError);
            expect(stub.requests).toHaveLength(1);
            expect(
                JSON.stringify(vi.mocked(console.error).mock.calls),
            ).not.toContain(apiKey);
        },
    );

    it("fails as unavailable on a timeout or when osu! cannot be reached", async () => {
        stub.handle(() => {
            // Never respond.
        });

        await expect(gateway.getBeatmap("priority", 1)).rejects.toBeInstanceOf(
            OsuUnavailableError,
        );

        const unreachable = new OsuGateway({
            apiKey,
            apiBaseUrl: "http://127.0.0.1:1/api",
            fileBaseUrl: "http://127.0.0.1:1/osu",
            limiter,
            timeoutMs: 200,
        });

        await expect(
            unreachable.downloadFile("priority", 1),
        ).rejects.toBeInstanceOf(OsuUnavailableError);
    });

    it("shares one request between concurrent calls in the same lane, but not across lanes", async () => {
        let release: () => void = () => undefined;
        const released = new Promise<void>((resolve) => (release = resolve));

        stub.handle((_req, res) => {
            void released.then(() => json([beatmap(1)])(undefined, res));
        });

        const calls = [
            gateway.getBeatmap("bulk", 1),
            gateway.getBeatmap("bulk", 1),
            gateway.getBeatmap("priority", 1),
        ];

        await vi.waitFor(() => {
            expect(stub.requests).toHaveLength(2);
        });
        release();

        const results = await Promise.all(calls);

        expect(results.every((r) => r?.beatmap_id === "1")).toBe(true);
        expect(stub.requests).toHaveLength(2);
    });

    it("skips an optional lookup when the limiter is busy", async () => {
        const tryNow = vi.spyOn(limiter, "tryNow").mockResolvedValue(undefined);

        expect(await gateway.tryGetBeatmapNow("priority", 1)).toBeUndefined();
        expect(tryNow).toHaveBeenCalledOnce();
        expect(stub.requests).toEqual([]);
    });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm exec vitest run tests/osu/OsuGateway.test.ts`
Expected: FAIL, cannot resolve `../../src/osu/OsuGateway.js`.

- [ ] **Step 4: Implement**

`src/osu/OsuGateway.ts`:

```ts
import type { OsuAPIResponse } from "@rian8337/osu-base";
import { OsuUnavailableError, type Lane, type RequestKind } from "./errors.js";
import type { RateLimiter } from "./RateLimiter.js";

export interface OsuGatewayOptions {
    readonly apiKey: string;
    readonly apiBaseUrl: string;
    readonly fileBaseUrl: string;
    readonly limiter: RateLimiter;

    /**
     * Defaults to 10 000.
     */
    readonly timeoutMs?: number;
}

/**
 * `Retry-After` hint for failures other than osu!'s own `429`.
 */
const failureRetryAfterSeconds = 5;

/**
 * Pause after a `429` without a `Retry-After` header.
 */
const defaultRateLimitPauseSeconds = 60;

type Outcome<T> =
    | { readonly kind: "ok"; readonly value: T }
    | { readonly kind: "rate-limited"; readonly retryAfterSeconds: number }
    | { readonly kind: "failed"; readonly reason: string };

function redact(url: string): string {
    return url.replace(/([?&]k=)[^&]*/, "$1<redacted>");
}

function parseRetryAfter(header: string | null): number | undefined {
    if (header === null) {
        return undefined;
    }

    const seconds = Number(header);

    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function isBeatmapList(body: unknown): body is OsuAPIResponse[] {
    return (
        Array.isArray(body) &&
        body.every(
            (entry) =>
                typeof entry === "object" &&
                entry !== null &&
                "beatmap_id" in entry &&
                "mode" in entry,
        )
    );
}

/**
 * The only code that calls osu!. Each operation is exactly one request through the rate limiter: no retries.
 * Concurrent calls in the same lane for the same thing share one request.
 */
export class OsuGateway {
    private readonly timeoutMs: number;
    private readonly inFlight = new Map<string, Promise<unknown>>();

    constructor(private readonly options: OsuGatewayOptions) {
        this.timeoutMs = options.timeoutMs ?? 10_000;
    }

    async getBeatmap(
        lane: Lane,
        idOrHash: number | string,
    ): Promise<OsuAPIResponse | null> {
        const list = await this.getBeatmapList(
            lane,
            this.beatmapQuery(idOrHash),
        );

        return OsuGateway.firstStandard(list);
    }

    async getBeatmapset(
        lane: Lane,
        id: number,
    ): Promise<OsuAPIResponse[] | null> {
        const list = await this.getBeatmapList(lane, `s=${id.toString()}`);

        return list.length > 0 ? list : null;
    }

    downloadFile(lane: Lane, id: number): Promise<Buffer | null> {
        return this.shared(`${lane}:file:${id.toString()}`, () =>
            this.options.limiter.schedule(lane, "file", () =>
                this.requestFile(id),
            ),
        );
    }

    async tryGetBeatmapNow(
        lane: Lane,
        idOrHash: number | string,
    ): Promise<OsuAPIResponse | null | undefined> {
        const query = this.beatmapQuery(idOrHash);
        const list = await this.options.limiter.tryNow(lane, "api", () =>
            this.requestBeatmapList(query),
        );

        return list === undefined ? undefined : OsuGateway.firstStandard(list);
    }

    private static firstStandard(
        list: readonly OsuAPIResponse[],
    ): OsuAPIResponse | null {
        const first = list.at(0);

        return first?.mode === "0" ? first : null;
    }

    private beatmapQuery(idOrHash: number | string): string {
        return typeof idOrHash === "number"
            ? `b=${idOrHash.toString()}`
            : `h=${idOrHash}`;
    }

    private getBeatmapList(
        lane: Lane,
        query: string,
    ): Promise<OsuAPIResponse[]> {
        return this.shared(`${lane}:api:${query}`, () =>
            this.options.limiter.schedule(lane, "api", () =>
                this.requestBeatmapList(query),
            ),
        );
    }

    private async requestBeatmapList(query: string): Promise<OsuAPIResponse[]> {
        const url = `${this.options.apiBaseUrl}/get_beatmaps?k=${this.options.apiKey}&${query}`;
        const outcome = await this.request(url, async (response) => {
            if (response.status !== 200) {
                return undefined;
            }

            const body: unknown = await response.json();

            return isBeatmapList(body) ? body : undefined;
        });

        return this.unwrap(url, outcome);
    }

    private async requestFile(id: number): Promise<Buffer | null> {
        const url = `${this.options.fileBaseUrl}/${id.toString()}`;
        const outcome = await this.request(url, async (response) => {
            if (response.status === 404) {
                await response.body?.cancel();

                return null;
            }

            if (response.status !== 200) {
                return undefined;
            }

            const bytes = Buffer.from(await response.arrayBuffer());

            return bytes.length > 0 ? bytes : null;
        });

        return this.unwrap(url, outcome);
    }

    /**
     * Sends one request. `read` returns the value, or `undefined` for an unusable response.
     */
    private async request<T>(
        url: string,
        read: (response: Response) => Promise<T | undefined>,
    ): Promise<Outcome<T>> {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(this.timeoutMs),
            });

            if (response.status === 429) {
                await response.body?.cancel();

                return {
                    kind: "rate-limited",
                    retryAfterSeconds:
                        parseRetryAfter(response.headers.get("retry-after")) ??
                        defaultRateLimitPauseSeconds,
                };
            }

            const value = await read(response);

            return value === undefined
                ? {
                      kind: "failed",
                      reason: `unusable response with status ${response.status.toString()}`,
                  }
                : { kind: "ok", value };
        } catch (e) {
            return {
                kind: "failed",
                reason: e instanceof Error ? e.message : String(e),
            };
        }
    }

    private unwrap<T>(url: string, outcome: Outcome<T>): T {
        switch (outcome.kind) {
            case "ok":
                return outcome.value;
            case "rate-limited":
                console.warn(
                    `osu! rate limited ${redact(url)}; pausing all requests for ${outcome.retryAfterSeconds.toString()} s`,
                );
                this.options.limiter.pauseFor(outcome.retryAfterSeconds * 1000);

                throw new OsuUnavailableError(outcome.retryAfterSeconds);
            case "failed":
                console.error(
                    `osu! request ${redact(url)} failed: ${outcome.reason}`,
                );

                throw new OsuUnavailableError(failureRetryAfterSeconds);
        }
    }

    private shared<T>(key: string, start: () => Promise<T>): Promise<T> {
        const existing = this.inFlight.get(key);

        if (existing) {
            // Every entry under this key was stored by this method with the same T.
            return existing as Promise<T>;
        }

        let promise: Promise<T>;

        try {
            promise = start();
        } catch (e) {
            return Promise.reject(
                e instanceof Error ? e : new Error(String(e)),
            );
        }

        this.inFlight.set(key, promise);
        void promise.then(
            () => this.inFlight.delete(key),
            () => this.inFlight.delete(key),
        );

        return promise;
    }
}

export type { RequestKind };
```

`src/osu/index.ts`:

```ts
import { getConfig, type Config } from "../config.js";
import { OsuGateway } from "./OsuGateway.js";
import { RateLimiter } from "./RateLimiter.js";

export * from "./errors.js";
export { OsuGateway } from "./OsuGateway.js";
export { RateLimiter } from "./RateLimiter.js";

/**
 * Builds the gateway and its rate limiter from the configuration.
 */
export function createOsuGateway(config: Config): OsuGateway {
    return new OsuGateway({
        apiKey: config.osuApiKey,
        apiBaseUrl: config.osuApiBaseUrl,
        fileBaseUrl: config.osuFileBaseUrl,
        limiter: new RateLimiter({
            ratesPerMinute: config.ratesPerMinute,
            bulkShare: config.bulkShare,
            maxWaitMs: config.maxWaitMs,
        }),
    });
}

let gateway: OsuGateway | undefined;

/**
 * The process-wide gateway (one rate limiter for the whole service), created on first use.
 */
export function getOsuGateway(): OsuGateway {
    gateway ??= createOsuGateway(getConfig());

    return gateway;
}
```

Remove the trailing `export type { RequestKind };` line from `OsuGateway.ts` if `RequestKind` ends up unused there (lint will tell you); it is exported from `errors.ts`.

`shared()` converts a synchronous throw from `start()` (the limiter's refusal) into a rejected promise that is not stored, so a refused call does not poison later calls.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/osu`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm format:check
git status
git add src/osu tests/osu/OsuGateway.test.ts tests/utils/stubOsu.ts
git commit -m "Add the osu! gateway

<attribution line>"
```

---

### Task 5: Use the gateway in storage, routes, and the populate script

**Files:**

- Modify: `src/utils/beatmap/beatmapStorage.ts`, `src/routes/getbeatmap.ts`, `src/routes/getbeatmapfile.ts`, `src/routes/getbeatmaps.ts`, `src/utils/security.ts`, `src/index.ts`, `src/populateCache.ts`
- Delete: `src/utils/beatmap/beatmapService.ts`
- Create: `src/utils/lane.ts`, `src/utils/errorHandler.ts`, `src/utils/beatmap/recheck.ts`
- Create: `tests/utils/security.test.ts`, `tests/utils/errorHandler.test.ts`, `tests/utils/beatmap/recheck.test.ts`

**Interfaces:**

- Consumes: `getOsuGateway`, `OsuGateway`, `OsuUnavailableError`, `Lane` (Tasks 2–4), `getConfig` (Task 2).
- Produces:

```ts
// src/utils/lane.ts
export function setLane(res: Response, lane: Lane): void;
export function getLane(res: Response): Lane; // throws if the key middleware has not run

// src/utils/security.ts
export function resolveLane(
    key: string | undefined,
    keys: { internal: string | undefined; bulk: string | undefined },
): Lane | null;
export function validateGETInternalKey(req, res, next): void; // existing name, now accepts either key and sets the lane

// src/utils/errorHandler.ts
export const osuUnavailableHandler: ErrorRequestHandler;

// src/utils/beatmap/recheck.ts
export type RecheckOutcome =
    | { readonly kind: "skipped" } // busy or failed: serve the cache unchanged
    | { readonly kind: "gone" } // osu! no longer has the beatmap: not found (as before)
    | { readonly kind: "fresh"; readonly beatmap: OsuAPIResponse };
export function recheckBeatmap(
    gateway: Pick<OsuGateway, "tryGetBeatmapNow">,
    lane: Lane,
    beatmapId: number,
): Promise<RecheckOutcome>;

// src/utils/beatmap/beatmapStorage.ts (signatures change)
export function getBeatmap(
    lane: Lane,
    beatmapIdOrHash: number | string,
): Promise<DatabaseBeatmap | null>;
export function getBeatmapset(
    lane: Lane,
    id: number,
): Promise<Map<number, DatabaseBeatmap> | null>;
export function getBeatmapFile(
    lane: Lane,
    id: number,
    hashComparison?: string,
): Promise<Buffer | null>;
```

- [ ] **Step 1: Write the failing tests**

`tests/utils/security.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveLane } from "../../src/utils/security.js";

describe("resolveLane", () => {
    const keys = { internal: "internal-key", bulk: "bulk-key" };

    it("maps the internal key to priority and the bulk key to bulk", () => {
        expect(resolveLane("internal-key", keys)).toBe("priority");
        expect(resolveLane("bulk-key", keys)).toBe("bulk");
    });

    it("rejects unknown and missing keys when an internal key is set", () => {
        expect(resolveLane("wrong", keys)).toBeNull();
        expect(resolveLane(undefined, keys)).toBeNull();
        expect(resolveLane("", keys)).toBeNull();
    });

    it("lets anyone use the priority lane when no internal key is set, but still honors the bulk key", () => {
        const open = { internal: undefined, bulk: "bulk-key" };

        expect(resolveLane(undefined, open)).toBe("priority");
        expect(resolveLane("anything", open)).toBe("priority");
        expect(resolveLane("bulk-key", open)).toBe("bulk");
    });
});
```

`tests/utils/errorHandler.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { OsuUnavailableError } from "../../src/osu/errors.js";
import { osuUnavailableHandler } from "../../src/utils/errorHandler.js";

describe("osuUnavailableHandler", () => {
    it("answers 503 with Retry-After and the error body", async () => {
        const app = express()
            .get("/", () => {
                throw new OsuUnavailableError(12.2);
            })
            .use(osuUnavailableHandler);

        const response = await request(app).get("/");

        expect(response.status).toBe(503);
        expect(response.headers["retry-after"]).toBe("13");
        expect(response.body).toEqual({
            error: "osu! is temporarily unavailable; retry later",
        });
    });

    it("passes other errors on", async () => {
        const app = express()
            .get("/", () => {
                throw new Error("boom");
            })
            .use(osuUnavailableHandler)
            .use(
                (
                    _error: unknown,
                    _req: express.Request,
                    res: express.Response,
                    // Express identifies error middleware by its four parameters.
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    _next: express.NextFunction,
                ) => {
                    res.status(500).json({ error: "other" });
                },
            );

        const response = await request(app).get("/");

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: "other" });
    });
});
```

`tests/utils/beatmap/recheck.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { OsuUnavailableError } from "../../../src/osu/errors.js";
import type { OsuGateway } from "../../../src/osu/OsuGateway.js";
import { recheckBeatmap } from "../../../src/utils/beatmap/recheck.js";

function gatewayReturning(
    result: Awaited<ReturnType<OsuGateway["tryGetBeatmapNow"]>> | Error,
): Pick<OsuGateway, "tryGetBeatmapNow"> {
    return {
        tryGetBeatmapNow: vi.fn(() =>
            result instanceof Error
                ? Promise.reject(result)
                : Promise.resolve(result),
        ),
    };
}

describe("recheckBeatmap", () => {
    it("skips when the limiter is busy", async () => {
        expect(
            await recheckBeatmap(gatewayReturning(undefined), "bulk", 1),
        ).toEqual({
            kind: "skipped",
        });
    });

    it("skips when osu! is unavailable, so the cached beatmap is still served", async () => {
        expect(
            await recheckBeatmap(
                gatewayReturning(new OsuUnavailableError(5)),
                "priority",
                1,
            ),
        ).toEqual({ kind: "skipped" });
    });

    it("reports a beatmap osu! no longer has", async () => {
        expect(
            await recheckBeatmap(gatewayReturning(null), "priority", 1),
        ).toEqual({
            kind: "gone",
        });
    });

    it("returns the fresh beatmap", async () => {
        const fresh = { beatmap_id: "1", mode: "0" };

        expect(
            await recheckBeatmap(
                // Only the fields the recheck reads matter here.
                gatewayReturning(
                    fresh as unknown as Awaited<
                        ReturnType<OsuGateway["tryGetBeatmapNow"]>
                    >,
                ),
                "priority",
                1,
            ),
        ).toEqual({ kind: "fresh", beatmap: fresh });
    });

    it("lets unexpected errors through", async () => {
        await expect(
            recheckBeatmap(gatewayReturning(new Error("bug")), "priority", 1),
        ).rejects.toThrow("bug");
    });
});
```

Run: `pnpm exec vitest run tests/utils`
Expected: FAIL, cannot resolve the new modules.

- [ ] **Step 2: Implement the lane helper, key check, error middleware, and recheck**

`src/utils/lane.ts`:

```ts
import type { Response } from "express";
import type { Lane } from "../osu/errors.js";

// Keyed by response, so the lane stays typed instead of living in `res.locals`.
const lanes = new WeakMap<Response, Lane>();

export function setLane(res: Response, lane: Lane): void {
    lanes.set(res, lane);
}

/**
 * The lane chosen by the request's key.
 *
 * @throws {Error} If the key middleware has not run for this response.
 */
export function getLane(res: Response): Lane {
    const lane = lanes.get(res);

    if (!lane) {
        throw new Error("The key middleware has not run for this request");
    }

    return lane;
}
```

Replace `src/utils/security.ts`:

```ts
import type { NextFunction, Request, Response } from "express";
import { getConfig } from "../config.js";
import type { Lane } from "../osu/errors.js";
import { setLane } from "./lane.js";

/**
 * The lane for a request key: the bulk key gives `bulk`; the internal key (or any key, when no internal key is
 * configured) gives `priority`; anything else is rejected.
 */
export function resolveLane(
    key: string | undefined,
    keys: { internal: string | undefined; bulk: string | undefined },
): Lane | null {
    if (keys.bulk !== undefined && key === keys.bulk) {
        return "bulk";
    }

    if (keys.internal === undefined || key === keys.internal) {
        return "priority";
    }

    return null;
}

/**
 * A middleware to validate the key of a GET request and record its lane.
 */
export function validateGETInternalKey(
    req: Request<unknown, { error?: string }, unknown, { key?: string }>,
    res: Response<{ error?: string }>,
    next: NextFunction,
): void {
    const { internalServerKey, bulkServerKey } = getConfig();
    const lane = resolveLane(req.query.key, {
        internal: internalServerKey,
        bulk: bulkServerKey,
    });

    if (!lane) {
        res.status(401).json({ error: "Unauthorized" });

        return;
    }

    setLane(res, lane);
    next();
}
```

If `setLane(res, …)` does not type-check because `res` is `Response<{ error?: string }>`, widen `setLane`/`getLane` to take `Response<unknown>`… only if needed; prefer making the helpers generic: `export function setLane(res: Response<unknown>, lane: Lane)` with `WeakMap<object, Lane>`.

`src/utils/errorHandler.ts`:

```ts
import type { ErrorRequestHandler } from "express";
import { OsuUnavailableError } from "../osu/errors.js";

/**
 * Answers `503` with `Retry-After` when osu! could not be asked. Other errors are passed on unchanged.
 */
export const osuUnavailableHandler: ErrorRequestHandler = (
    error,
    _req,
    res,
    next,
) => {
    if (!(error instanceof OsuUnavailableError)) {
        next(error);

        return;
    }

    res.setHeader("Retry-After", error.retryAfterSeconds.toString());
    res.status(503).json({ error: error.message });
};
```

`src/utils/beatmap/recheck.ts`:

```ts
import type { OsuAPIResponse } from "@rian8337/osu-base";
import { OsuUnavailableError, type Lane } from "../../osu/errors.js";
import type { OsuGateway } from "../../osu/OsuGateway.js";

export type RecheckOutcome =
    | { readonly kind: "skipped" }
    | { readonly kind: "gone" }
    | { readonly kind: "fresh"; readonly beatmap: OsuAPIResponse };

/**
 * The optional status re-check of a cached unranked beatmap. It never fails a request: when the limiter is busy
 * or osu! is unavailable, it is skipped and the cached beatmap is served.
 */
export async function recheckBeatmap(
    gateway: Pick<OsuGateway, "tryGetBeatmapNow">,
    lane: Lane,
    beatmapId: number,
): Promise<RecheckOutcome> {
    let beatmap: OsuAPIResponse | null | undefined;

    try {
        beatmap = await gateway.tryGetBeatmapNow(lane, beatmapId);
    } catch (e) {
        if (e instanceof OsuUnavailableError) {
            return { kind: "skipped" };
        }

        throw e;
    }

    if (beatmap === undefined) {
        return { kind: "skipped" };
    }

    return beatmap === null ? { kind: "gone" } : { kind: "fresh", beatmap };
}
```

Run: `pnpm exec vitest run tests/utils`
Expected: PASS.

- [ ] **Step 3: Rewire storage on the gateway**

In `src/utils/beatmap/beatmapStorage.ts`:

1. Replace the imports of `* as beatmapService from "./beatmapService.js"` with:

```ts
import { getOsuGateway } from "../../osu/index.js";
import type { Lane } from "../../osu/errors.js";
import { recheckBeatmap } from "./recheck.js";
```

and keep `MapInfo`, `RankedStatus` from `@rian8337/osu-base`.

2. Replace `getBeatmap` with:

```ts
/**
 * Gets a beatmap from the beatmap cache, or asks osu! if it is not available.
 *
 * @param lane The lane of the request.
 * @param beatmapIdOrHash The beatmap ID or MD5 hash of the beatmap.
 * @returns The beatmap, `null` if osu! does not have it.
 * @throws {OsuUnavailableError} If osu! could not be asked.
 */
export async function getBeatmap(
    lane: Lane,
    beatmapIdOrHash: number | string,
): Promise<DatabaseBeatmap | null> {
    const gateway = getOsuGateway();

    // Get cache from in-memory cache.
    let cache =
        (typeof beatmapIdOrHash === "number"
            ? databaseBeatmapIdCache.get(beatmapIdOrHash)
            : databaseBeatmapHashCache.get(beatmapIdOrHash)) ?? null;

    // Get cache from database.
    cache ??= await getBeatmapFromDatabase(beatmapIdOrHash);

    // If not found, ask osu!.
    if (!cache) {
        const apiBeatmap = await gateway.getBeatmap(lane, beatmapIdOrHash);

        if (!apiBeatmap) {
            return null;
        }

        cache = convertMapInfoToDatabaseBeatmap(MapInfo.from(apiBeatmap));

        // When retrieving with beatmap hash, the beatmap may be invalid when the new hash is retrieved.
        // In that case, invalidate the cache.
        if (typeof beatmapIdOrHash === "string") {
            if (databaseBeatmapIdCache.has(cache.beatmap_id)) {
                await invalidateBeatmapCache(beatmapIdOrHash, cache);
            } else {
                // Check if the old beatmap cache is in the database.
                const oldCache = await getBeatmapFromDatabase(cache.beatmap_id);

                if (oldCache && oldCache.file_md5 !== cache.file_md5) {
                    await invalidateBeatmapCache(beatmapIdOrHash, cache);
                }
            }
        }

        // Insert the cache to the database.
        await insertBeatmapsToDatabase(cache);
    }

    // For unranked beatmaps, re-check the status if 15 minutes have passed since the last check, but only when
    // osu!'s budget is idle: a busy or failed re-check serves the cached beatmap unchanged.
    if (
        cache.approved !== RankedStatus.Ranked &&
        cache.approved !== RankedStatus.Approved &&
        cache.last_checked < new Date(Date.now() - 900000)
    ) {
        const recheck = await recheckBeatmap(gateway, lane, cache.beatmap_id);

        if (recheck.kind === "gone") {
            return null;
        }

        if (recheck.kind === "fresh") {
            const apiBeatmap = MapInfo.from(recheck.beatmap);

            if (cache.file_md5 !== apiBeatmap.hash) {
                // Beatmap has been updated - invalidate cache completely.
                const oldHash = cache.file_md5;

                cache = convertMapInfoToDatabaseBeatmap(apiBeatmap);

                await invalidateBeatmapCache(oldHash, cache);
                await insertBeatmapsToDatabase(cache);
            } else {
                // Update the last checked date.
                cache.last_checked = new Date();
                cache.approved = apiBeatmap.approved;

                await db
                    .update(beatmapTable)
                    .set({
                        last_checked: cache.last_checked,
                        approved: cache.approved,
                    })
                    .where(eq(beatmapTable.beatmap_id, cache.beatmap_id))
                    .catch((e: unknown) => {
                        console.error("Error when updating beatmap status:", e);
                    });
            }
        }
    }

    // Cache the beatmap in memory.
    databaseBeatmapIdCache.set(cache.beatmap_id, cache);
    databaseBeatmapHashCache.set(cache.file_md5, cache);

    return cache;
}
```

3. In `getBeatmapset`, add the `lane: Lane` first parameter, update the doc comment (`@throws {OsuUnavailableError}`), and replace `await beatmapService.getBeatmapsetFromOsuAPI(id)` with `await getOsuGateway().getBeatmapset(lane, id)`.

4. In `getBeatmapFile`, add the `lane: Lane` first parameter, update the doc comment, and replace `await beatmapService.getBeatmapFile(id)` with `await getOsuGateway().downloadFile(lane, id)`.

Delete `src/utils/beatmap/beatmapService.ts`.

- [ ] **Step 4: Rewire the routes, the server, and the populate script**

In each route, import `getLane` from `../utils/lane.js` and pass `getLane(res)` as the first argument to every storage call:

- `src/routes/getbeatmap.ts`: `getBeatmap(getLane(res), id !== undefined ? parseInt(id) : hash!)`.
- `src/routes/getbeatmaps.ts`: `getBeatmapset(getLane(res), parseInt(id))`.
- `src/routes/getbeatmapfile.ts`: `getBeatmap(getLane(res), hash!)` and `getBeatmapFile(getLane(res), beatmapId, beatmap?.file_md5)`.

`express-async-handler` already forwards rejections to `next`, so an `OsuUnavailableError` reaches the error middleware without other route changes.

Replace `src/index.ts`:

```ts
import { config } from "dotenv";
import express, { Router } from "express";
import cors from "cors";
import { ConfigError, getConfig } from "./config.js";
import getBeatmap from "./routes/getbeatmap.js";
import getBeatmapFile from "./routes/getbeatmapfile.js";
import getBeatmaps from "./routes/getbeatmaps.js";
import { osuUnavailableHandler } from "./utils/errorHandler.js";

config();

try {
    // Fail fast on invalid rate limit settings instead of on the first request.
    getConfig();
} catch (e) {
    console.error(e instanceof ConfigError ? e.message : e);
    process.exit(1);
}

const baseRouter = Router()
    .use("/getbeatmap", getBeatmap)
    .use("/getbeatmapfile", getBeatmapFile)
    .use("/getbeatmaps", getBeatmaps);

const app = express()
    .use(cors())
    .use("/api/beatmap", baseRouter)
    .use(osuUnavailableHandler);

const port = parseInt(process.env.EXPRESS_PORT ?? "3000");

app.listen(port, () => {
    console.log(`Server is running on port ${port.toString()}`);
});
```

(The old `OsuAPIRequestBuilder.setAPIKey` call is gone: the gateway sends the key itself.)

Replace `src/populateCache.ts`:

```ts
import "dotenv/config";
import { RankedStatus, Utils } from "@rian8337/osu-base";
import { db } from "./database/index.js";
import { populateTable } from "./database/schema.js";
import { getOsuGateway, OsuUnavailableError } from "./osu/index.js";
import { convertOsuAPIResponseToDatabaseBeatmap } from "./utils/beatmap/beatmapConverter.js";
import { insertBeatmapsToDatabase } from "./utils/beatmap/beatmapStorage.js";

// Walks every beatmapset ID through osu! on the bulk lane. The rate limiter paces it, and it waits out
// refusals and 429 pauses instead of skipping IDs.
void (async () => {
    const gateway = getOsuGateway();
    let id = await db
        .select()
        .from(populateTable)
        .limit(1)
        .then((res) => res.at(0)?.id ?? null);

    if (id === null) {
        id = 1;

        await db.insert(populateTable).values({ id });
    }

    while (id <= 2500000) {
        await db.update(populateTable).set({ id });

        let beatmaps;

        try {
            beatmaps = await gateway.getBeatmapset("bulk", id);
        } catch (e) {
            if (e instanceof OsuUnavailableError) {
                await Utils.sleep(e.retryAfterSeconds);
                continue;
            }

            throw e;
        }

        if (beatmaps === null) {
            console.log("Beatmapset with ID", id++, "not found.");
            continue;
        }

        console.log("Beatmapset with ID", id++, "found.");

        await insertBeatmapsToDatabase(
            ...beatmaps
                .map(convertOsuAPIResponseToDatabaseBeatmap)
                .filter(
                    (v) =>
                        v.approved === RankedStatus.Ranked ||
                        v.approved === RankedStatus.Approved,
                ),
        );
    }
})();
```

(`Utils.sleep` takes seconds, as the old script's `Utils.sleep(0.1)` did. Check the import path of `populateTable`: use whatever module the original file imported it from, with `.js` added.)

- [ ] **Step 5: Verify, smoke-test, and commit**

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm format:check
rm -rf dist && pnpm build
OSU_API_KEY=x EXPRESS_PORT=39123 timeout 4 node dist/index.js; echo "exit $?"
BULK_SHARE=2 OSU_API_KEY=x EXPRESS_PORT=39124 node dist/index.js; echo "exit $?"
grep -rn "OsuAPIRequestBuilder\|getInformation" src || echo "no direct osu-base requests left"
```

Expected: checks pass; the first start prints `Server is running on port 39123` (then `timeout` ends it); the second exits 1 with an `Invalid configuration` message naming `BULK_SHARE`; the grep finds nothing. Do not leave a server running.

```bash
git status
git add -A src tests
git commit -m "Route every osu! request through the rate-limited gateway

<attribution line>"
```

---

### Task 6: Document the configuration and rollout

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add the configuration section**

Add to `README.md`, after the existing environment variable list (keep the existing entries), a section:

````markdown
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
```

`populateCache.ts` uses the bulk lane and is paced automatically, so it can run alongside the service.
````

Also update the README's run instructions if they mention `npm i` / CommonJS specifics that changed (the start command is unchanged).

- [ ] **Step 2: Verify and commit**

```bash
pnpm format:check
git status
git add README.md
git commit -m "Document the osu! rate limit settings

<attribution line>"
```

Rollout (for the user, not the implementer): deploy; create `BULK_SERVER_KEY` and set it as `BEATMAP_SERVICE_KEY` on every dpp processor (and the old dpp backend while it recalculates); then open the dpp broker.
