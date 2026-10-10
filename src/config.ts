import { resolve } from "path";
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
        BEATMAP_FILE_DIRECTORY: z.string().default("beatmaps"),
        RECHECK_QUALIFIED_MINUTES: z.coerce.number().int().min(1).default(15),
        RECHECK_PENDING_MINUTES: z.coerce.number().int().min(1).default(60),
        RECHECK_GRAVEYARD_MINUTES: z.coerce.number().int().min(1).default(1440),
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
        beatmapFileDirectory: resolve(values.BEATMAP_FILE_DIRECTORY),
        recheckMinutes: {
            qualified: values.RECHECK_QUALIFIED_MINUTES,
            pending: values.RECHECK_PENDING_MINUTES,
            graveyard: values.RECHECK_GRAVEYARD_MINUTES,
        },
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
