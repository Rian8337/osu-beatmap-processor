import { computeMD5 } from "@/beatmaps/md5";
import { describe, expect, it } from "vitest";

describe("computeMD5", () => {
    it("hashes bytes as lowercase hex", () => {
        expect(computeMD5(Buffer.from("hello"))).toBe(
            "5d41402abc4b2a76b9719d911017c592",
        );
    });
});
