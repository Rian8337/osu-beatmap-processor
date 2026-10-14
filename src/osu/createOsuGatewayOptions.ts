import type { Config } from "@/config/config";
import type { OsuGatewayOptions } from "./OsuGateway";
import { RateLimiter } from "./RateLimiter";

/**
 * The gateway's settings and its rate limiter. A process creates this once: the limiter is the process's whole osu!
 * budget.
 */
export function createOsuGatewayOptions(config: Config): OsuGatewayOptions {
    return {
        apiKey: config.osu.apiKey,
        apiBaseUrl: config.osu.apiBaseUrl,
        fileBaseUrl: config.osu.fileBaseUrl,
        rateLimiter: new RateLimiter({
            ratesPerMinute: config.ratesPerMinute,
            bulkShare: config.bulkShare,
            maxWaitMs: config.maxWaitMs,
        }),
    };
}
