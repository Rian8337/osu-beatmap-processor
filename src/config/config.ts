import type { DatabaseSettings } from "@/server";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * A value for Express's `trust proxy` setting: `true`, `false`, a hop count, or addresses and subnets.
 */
export type TrustProxySetting = boolean | number | string;

/**
 * Settings read from environment variables.
 */
export interface Config {
    readonly port: number;
    readonly database: DatabaseSettings;
    readonly osu: {
        readonly apiKey: string;
        readonly apiBaseUrl: string;
        readonly fileBaseUrl: string;
    };

    /**
     * Keys from the environment that work like unlimited database keys: `priority` (`INTERNAL_SERVER_KEY`) for the
     * priority lane, `bulk` (`BULK_SERVER_KEY`) for the bulk lane.
     */
    readonly builtInKeys: {
        readonly priority: string | undefined;
        readonly bulk: string | undefined;
    };
    readonly ratesPerMinute: {
        readonly api: number;
        readonly file: number;
        readonly total: number;
    };

    /**
     * The fraction of each osu! budget the bulk lane may use, in (0, 1].
     */
    readonly bulkShare: number;
    readonly maxWaitMs: { readonly priority: number; readonly bulk: number };

    /**
     * The absolute path of the directory where `.osu` files are stored.
     */
    readonly beatmapFileDirectory: string;

    /**
     * How long a cached beatmap of each status is trusted before its status is re-checked with osu!. Ranked,
     * approved, and loved beatmaps are never re-checked.
     */
    readonly recheckMinutes: {
        readonly qualified: number;
        /** Pending and WIP beatmaps. */
        readonly pending: number;
        readonly graveyard: number;
    };

    /**
     * Entry limits of the memory caches: `beatmaps` for each of the ID and hash caches, `beatmapsets` for sets.
     */
    readonly cacheSize: {
        readonly beatmaps: number;
        readonly beatmapsets: number;
    };

    /**
     * Requests per minute per IP without a key; 0 requires a key.
     */
    readonly anonymousRateLimit: number;
    readonly keyReloadIntervalSeconds: number;
    readonly trustProxy: TrustProxySetting;
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

const port = z.coerce.number().int().min(0).max(65535);
const perMinute = z.coerce.number().int().min(1);
const positive = z.coerce.number().int().min(1);
const milliseconds = z.coerce.number().int().min(0);
const baseUrl = z.url().transform((url) => url.replace(/\/+$/, ""));

const databaseShape = {
    POSTGRES_HOSTNAME: z.string(),
    POSTGRES_PORT: port.default(5432),
    POSTGRES_DB_NAME: z.string(),
    POSTGRES_USERNAME: z.string(),
    POSTGRES_PASSWORD: z.string().default(""),
};

const databaseSchema = z.object(databaseShape);

const schema = z
    .object({
        ...databaseShape,
        EXPRESS_PORT: port.default(3000),
        OSU_API_KEY: z.string(),
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
        BEATMAP_FILE_DIRECTORY: z.string().default("beatmaps"),
        RECHECK_QUALIFIED_MINUTES: positive.default(15),
        RECHECK_PENDING_MINUTES: positive.default(60),
        RECHECK_GRAVEYARD_MINUTES: positive.default(1440),
        BEATMAP_CACHE_SIZE: positive.default(10_000),
        BEATMAPSET_CACHE_SIZE: positive.default(2000),
        ANON_RATE_LIMIT: z.coerce.number().int().min(0).default(30),
        KEY_RELOAD_INTERVAL_SECONDS: positive.default(30),
        TRUST_PROXY: z.string().default("false").transform(parseTrustProxy),
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

function parseTrustProxy(value: string): TrustProxySetting {
    if (value === "true") {
        return true;
    }

    if (value === "false") {
        return false;
    }

    return /^\d+$/.test(value) ? Number(value) : value;
}

function parse<T extends z.ZodType>(
    target: T,
    env: NodeJS.ProcessEnv,
): z.infer<T> {
    // An empty variable (`EXPRESS_PORT=`) counts as unset, instead of being coerced to 0.
    const present = Object.fromEntries(
        Object.entries(env).filter(([, value]) => value !== ""),
    );
    const result = target.safeParse(present);

    if (!result.success) {
        // Issue messages name the variable (path) and the rule, never the value.
        const problems = result.error.issues.map((issue) =>
            issue.path.length > 0
                ? `${issue.path.join(".")}: ${issue.message}`
                : issue.message,
        );

        throw new ConfigError(
            `Invalid configuration:\n  ${problems.join("\n  ")}`,
        );
    }

    return result.data;
}

function buildDatabaseSettings(
    values: z.infer<typeof databaseSchema>,
): DatabaseSettings {
    return {
        host: values.POSTGRES_HOSTNAME,
        port: values.POSTGRES_PORT,
        name: values.POSTGRES_DB_NAME,
        user: values.POSTGRES_USERNAME,
        password: values.POSTGRES_PASSWORD,
    };
}

/**
 * Reads and validates the configuration. Empty variables count as unset.
 *
 * @throws {ConfigError} If any variable is missing or invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
    const values = parse(schema, env);

    return {
        port: values.EXPRESS_PORT,
        database: buildDatabaseSettings(values),
        osu: {
            apiKey: values.OSU_API_KEY,
            apiBaseUrl: values.OSU_API_BASE_URL,
            fileBaseUrl: values.OSU_FILE_BASE_URL,
        },
        builtInKeys: {
            priority: values.INTERNAL_SERVER_KEY,
            bulk: values.BULK_SERVER_KEY,
        },
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
        beatmapFileDirectory: resolve(values.BEATMAP_FILE_DIRECTORY),
        recheckMinutes: {
            qualified: values.RECHECK_QUALIFIED_MINUTES,
            pending: values.RECHECK_PENDING_MINUTES,
            graveyard: values.RECHECK_GRAVEYARD_MINUTES,
        },
        cacheSize: {
            beatmaps: values.BEATMAP_CACHE_SIZE,
            beatmapsets: values.BEATMAPSET_CACHE_SIZE,
        },
        anonymousRateLimit: values.ANON_RATE_LIMIT,
        keyReloadIntervalSeconds: values.KEY_RELOAD_INTERVAL_SECONDS,
        trustProxy: values.TRUST_PROXY,
    };
}

/**
 * Reads only the database variables, for CLI commands that need nothing else.
 *
 * @throws {ConfigError} If any database variable is missing or invalid.
 */
export function loadDatabaseConfig(env: NodeJS.ProcessEnv): DatabaseSettings {
    return buildDatabaseSettings(parse(databaseSchema, env));
}
