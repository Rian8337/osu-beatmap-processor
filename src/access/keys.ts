import { createHash, randomBytes } from "node:crypto";

/**
 * A new API key: 32 random bytes, base64url-encoded (43 characters).
 */
export function generateApiKey(): string {
    return randomBytes(32).toString("base64url");
}

/**
 * The SHA-256 hash (hex) under which a key is stored and looked up.
 */
export function hashApiKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
}
