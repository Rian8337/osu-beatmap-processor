import { describe, expect, it } from "vitest";
import { resolveLane } from "../../src/utils/security.js";

describe("resolveLane", () => {
    const keys = { internal: "internal-key", bulk: "bulk-key" };

    it("maps the internal key to priority and the bulk key to bulk", () => {
        expect(resolveLane("internal-key", keys)).toBe("priority");
        expect(resolveLane("bulk-key", keys)).toBe("bulk");
    });

    it("rejects unknown and missing keys when an internal key is set", () => {
        expect(resolveLane("wrong", keys)).toBeNull();
        expect(resolveLane(undefined, keys)).toBeNull();
        expect(resolveLane("", keys)).toBeNull();
    });

    it("lets anyone use the priority lane when no internal key is set, but still honors the bulk key", () => {
        const open = { internal: undefined, bulk: "bulk-key" };

        expect(resolveLane(undefined, open)).toBe("priority");
        expect(resolveLane("anything", open)).toBe("priority");
        expect(resolveLane("bulk-key", open)).toBe("bulk");
    });
});
