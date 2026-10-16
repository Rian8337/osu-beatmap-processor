import type { Lane } from "@/osu/errors";

/**
 * An API key as the service uses it.
 */
export interface ApiKeyRecord {
    readonly name: string;
    readonly lane: Lane;

    /**
     * Requests per minute, `null` for unlimited.
     */
    readonly rateLimitPerMinute: number | null;
}

/**
 * A stored key with the hash it is looked up by.
 */
export interface StoredApiKey extends ApiKeyRecord {
    readonly keyHash: string;
}

/**
 * A key as the CLI lists it.
 */
export interface KeyListing extends ApiKeyRecord {
    readonly createdAt: Date;
    readonly revokedAt: Date | null;
}

export type Caller =
    | { readonly kind: "key"; readonly key: ApiKeyRecord }
    | { readonly kind: "anonymous" };

export const anonymousCaller: Caller = { kind: "anonymous" };

/**
 * The lane a caller's requests use: a key's lane, or bulk for anonymous callers, so that public traffic never slows
 * down the game or the bot.
 */
export function getCallerLane(caller: Caller): Lane {
    return caller.kind === "key" ? caller.key.lane : "bulk";
}
