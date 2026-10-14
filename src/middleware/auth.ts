import type { IKeyService } from "@/access/IKeyService";
import { anonymousCaller } from "@/access/types";
import { setCaller } from "@/http/requestContext";
import { UnauthorizedError } from "@/server";
import type { RequestHandler } from "express";

/**
 * Identifies the caller from the `X-Api-Key` header or the `key` query parameter (which the game, the bot, and the
 * dpp processors send). No key means anonymous, unless anonymous access is off. An unknown, revoked, or empty key,
 * a repeated `key` parameter, or a header and a parameter that differ are rejected rather than treated as
 * anonymous, so a misconfigured client notices at once.
 */
export function createAuthMiddleware(
    keys: Pick<IKeyService, "authenticate">,
    options: { readonly allowAnonymous: boolean },
): RequestHandler {
    const reject = (res: Parameters<RequestHandler>[1], message?: string) => {
        const error = new UnauthorizedError(message);

        res.status(error.statusCode).json(error.toResponse());
    };

    return (req, res, next) => {
        const header = req.get("x-api-key");
        const query: unknown = req.query.key;

        if (query !== undefined && typeof query !== "string") {
            reject(res);

            return;
        }

        if (header !== undefined && query !== undefined && header !== query) {
            reject(res);

            return;
        }

        const raw = header ?? query;

        if (raw === undefined) {
            if (!options.allowAnonymous) {
                reject(res, "API key required");

                return;
            }

            setCaller(res, anonymousCaller);
            next();

            return;
        }

        const key = keys.authenticate(raw);

        if (!key) {
            reject(res);

            return;
        }

        setCaller(res, { kind: "key", key });
        next();
    };
}
