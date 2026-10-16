const namePattern = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Whether a key name is allowed: lowercase letters, digits, and hyphens, not starting with a hyphen. Built-in key
 * names contain a colon, so a stored key can never take one.
 */
export function isValidKeyName(name: string): boolean {
    return namePattern.test(name);
}
