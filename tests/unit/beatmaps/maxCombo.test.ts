import { keepStoredMaxCombo } from "@/beatmaps/maxCombo";
import { buildBeatmapRow } from "@test/utils/rows";
import { describe, expect, it } from "vitest";

describe("keepStoredMaxCombo", () => {
    const fresh = buildBeatmapRow({ max_combo: null });

    it("keeps the stored max combo for the same file when osu! sends none", () => {
        expect(
            keepStoredMaxCombo(fresh, { fileMd5: fresh.fileMd5, maxCombo: 314 })
                .maxCombo,
        ).toBe(314);
    });

    it("drops it when the file changed", () => {
        expect(
            keepStoredMaxCombo(fresh, {
                fileMd5: "f".repeat(32),
                maxCombo: 314,
            }).maxCombo,
        ).toBeNull();
    });

    it("prefers osu!'s max combo, and copes with nothing stored", () => {
        const known = buildBeatmapRow({ max_combo: "200" });

        expect(
            keepStoredMaxCombo(known, { fileMd5: known.fileMd5, maxCombo: 314 })
                .maxCombo,
        ).toBe(200);
        expect(keepStoredMaxCombo(fresh, undefined)).toBe(fresh);
    });
});
