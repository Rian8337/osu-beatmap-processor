import { describe, expect, it } from "vitest";
import { computeMD5 } from "../../src/utils/util.js";

describe("computeMD5", () => {
    it("hashes bytes as lowercase hex", () => {
        expect(computeMD5(Buffer.from("abc"))).toBe(
            "900150983cd24fb0d6963f7d28e17f72",
        );
    });
});
