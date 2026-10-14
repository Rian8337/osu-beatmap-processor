import { generateApiKey, hashApiKey } from "@/access/keys";
import { isValidKeyName } from "@/access/names";
import { describe, expect, it } from "vitest";

describe("API keys", () => {
    it("generates distinct 43-character base64url keys", () => {
        const a = generateApiKey();

        expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(generateApiKey()).not.toBe(a);
    });

    it("hashes with SHA-256", () => {
        expect(hashApiKey("abc")).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
    });

    it.each([
        ["discord-bot", true],
        ["site2", true],
        ["-bot", false],
        ["Bot", false],
        ["built-in:priority", false],
        ["", false],
    ])("name %j valid: %s", (name, valid) => {
        expect(isValidKeyName(name)).toBe(valid);
    });
});
