import {
    parseBeatmapReference,
    parseBeatmapsetId,
} from "@/beatmaps/validation";
import { BadRequestError } from "@/server";
import { describe, expect, it } from "vitest";

function captureFailureMessage(run: () => unknown): string {
    try {
        run();
    } catch (e) {
        expect(e).toBeInstanceOf(BadRequestError);

        return (e as BadRequestError).message;
    }

    throw new Error("expected a BadRequestError");
}

const hash = "0123456789abcdef0123456789abcdef";

describe("parseBeatmapReference", () => {
    it("reads an id", () => {
        expect(parseBeatmapReference({ id: "75" })).toEqual({ id: 75 });
        expect(parseBeatmapReference({ id: "2147483647" })).toEqual({
            id: 2147483647,
        });
    });

    it("prefers the id when both are given", () => {
        expect(parseBeatmapReference({ id: "75", hash: "nonsense" })).toEqual({
            id: 75,
        });
    });

    it("reads a hash in any case, lowercased", () => {
        expect(parseBeatmapReference({ hash: hash.toUpperCase() })).toEqual({
            hash,
        });
    });

    it("treats empty values as missing", () => {
        expect(parseBeatmapReference({ id: "", hash })).toEqual({ hash });
        expect(
            captureFailureMessage(() =>
                parseBeatmapReference({ id: "", hash: "" }),
            ),
        ).toBe("Missing id or hash");
        expect(captureFailureMessage(() => parseBeatmapReference({}))).toBe(
            "Missing id or hash",
        );
    });

    it.each([
        ["abc"],
        ["0"],
        ["-1"],
        ["+5"],
        [" 75"],
        ["7.5"],
        ["1e3"],
        ["2147483648"],
        [["1", "2"]],
        [{ a: "1" }],
    ])("rejects the id %j", (id) => {
        expect(captureFailureMessage(() => parseBeatmapReference({ id }))).toBe(
            "Invalid id",
        );
    });

    it.each([
        ["0123456789abcdef0123456789abcde"],
        ["0123456789abcdef0123456789abcdef0"],
        ["0123456789abcdef0123456789abcdeg"],
        [[hash, hash]],
    ])("rejects the hash %j", (value) => {
        expect(
            captureFailureMessage(() => parseBeatmapReference({ hash: value })),
        ).toBe("Invalid hash");
    });
});

describe("parseBeatmapsetId", () => {
    it("reads an id", () => {
        expect(parseBeatmapsetId({ id: "1" })).toBe(1);
    });

    it("needs an id", () => {
        expect(captureFailureMessage(() => parseBeatmapsetId({}))).toBe(
            "Missing id",
        );
        expect(captureFailureMessage(() => parseBeatmapsetId({ id: "" }))).toBe(
            "Missing id",
        );
        expect(captureFailureMessage(() => parseBeatmapsetId({ hash }))).toBe(
            "Missing id",
        );
    });

    it("rejects an invalid id", () => {
        expect(
            captureFailureMessage(() => parseBeatmapsetId({ id: "x" })),
        ).toBe("Invalid id");
    });
});
