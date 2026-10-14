import { createHealthHandler } from "@/controllers/health";
import { dependencyTokens } from "@/dependencies/tokens";
import { createAuthMiddleware } from "@/middleware/auth";
import { createRateLimitMiddleware } from "@/middleware/rateLimit";
import { createRouter, errorHandler, getContainer } from "@/server";
import cors from "cors";
import { sql } from "drizzle-orm";
import express, { Router, type Express, type RequestHandler } from "express";
// Load controllers so their metadata is registered before the router is built.
import "./controllers";

/**
 * Creates the Express application. Everything lives under `/api/beatmap`. `/health` comes before authentication;
 * every other request is authenticated and rate limited first. Unknown routes fall through to Express's default
 * HTML 404, never a JSON `{ error }` 404 (see `errorHandlers.ts`).
 *
 * @param earlyHandlers Middleware to run before everything else, in order, such as `GracefulServer.middleware`.
 */
export function createApp(
    container = getContainer(),
    ...earlyHandlers: RequestHandler[]
): Express {
    const config = container.resolve(dependencyTokens.config);
    const keys = container.resolve(dependencyTokens.keyService);
    const db = container.resolve(dependencyTokens.db);

    const api = Router()
        .get(
            "/health",
            createHealthHandler(() => db.execute(sql`select 1`)),
        )
        .use(
            createAuthMiddleware(keys, {
                // ANON_RATE_LIMIT=0 turns anonymous access off.
                allowAnonymous: config.anonymousRateLimit > 0,
            }),
        )
        .use(
            createRateLimitMiddleware({
                anonymousLimit: config.anonymousRateLimit,
            }),
        )
        .use(createRouter(container));

    const app = express()
        .disable("x-powered-by")
        .set("trust proxy", config.trustProxy);

    // Express rejects `use()` with no handlers.
    if (earlyHandlers.length > 0) {
        app.use(...earlyHandlers);
    }

    return app
        .use(
            cors({
                exposedHeaders: [
                    "Content-Disposition",
                    "RateLimit",
                    "RateLimit-Policy",
                    "Retry-After",
                ],
            }),
        )
        .use("/api/beatmap", api)
        .use(errorHandler);
}
