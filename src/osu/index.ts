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
