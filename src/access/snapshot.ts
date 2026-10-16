import type { Config } from "@/config/config";
import { hashApiKey } from "./keys";
import type { ApiKeyRecord, StoredApiKey } from "./types";

/**
 * Keys by their hash.
 */
export type KeySnapshot = ReadonlyMap<string, ApiKeyRecord>;

export const builtInKeyNames = {
    priority: "built-in:priority",
    bulk: "built-in:bulk",
} as const;

/**
 * The keys requests can use: the built-in keys from the environment (unlimited, one per lane), then the stored keys.
 * A stored key whose hash equals a built-in key's is ignored.
 */
export function buildKeySnapshot(
    stored: readonly StoredApiKey[],
    builtIn: Config["builtInKeys"],
): KeySnapshot {
    const keys = new Map<string, ApiKeyRecord>();

    if (builtIn.priority !== undefined) {
        keys.set(hashApiKey(builtIn.priority), {
            name: builtInKeyNames.priority,
            lane: "priority",
            rateLimitPerMinute: null,
        });
    }

    if (builtIn.bulk !== undefined) {
        keys.set(hashApiKey(builtIn.bulk), {
            name: builtInKeyNames.bulk,
            lane: "bulk",
            rateLimitPerMinute: null,
        });
    }

    for (const { keyHash, name, lane, rateLimitPerMinute } of stored) {
        if (!keys.has(keyHash)) {
            keys.set(keyHash, { name, lane, rateLimitPerMinute });
        }
    }

    return keys;
}
