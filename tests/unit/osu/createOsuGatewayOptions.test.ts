import { createOsuGatewayOptions } from "@/osu/createOsuGatewayOptions";
import { RateLimiter } from "@/osu/RateLimiter";
import { testConfig } from "@test/utils/config";
import { describe, expect, it } from "vitest";

describe("createOsuGatewayOptions", () => {
    it("takes the osu! settings and builds one limiter", () => {
        const options = createOsuGatewayOptions(testConfig);

        expect(options).toMatchObject({
            apiKey: "test-osu-key",
            apiBaseUrl: "http://127.0.0.1:9/api",
            fileBaseUrl: "http://127.0.0.1:9/osu",
        });
        expect(options.rateLimiter).toBeInstanceOf(RateLimiter);
    });
});
