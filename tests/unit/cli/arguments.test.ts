import {
    expectPositionals,
    parseArguments,
    parseLane,
    parseLimit,
    requireValidName,
} from "@/cli/arguments";
import { CliError } from "@/cli/errors";
import { describe, expect, it } from "vitest";

describe("CLI arguments", () => {
    it("parses options strictly", () => {
        expect(
            parseArguments(["site", "--limit", "5"], {
                limit: { type: "string" },
            }),
        ).toMatchObject({ values: { limit: "5" }, positionals: ["site"] });
        expect(() => parseArguments(["--nope"], {})).toThrow(CliError);
    });

    it("checks positionals", () => {
        expect(expectPositionals(["a"], ["name"])).toEqual(["a"]);
        expect(() => expectPositionals([], ["name"])).toThrow(
            "Expected <name>",
        );
        expect(() => expectPositionals(["a"], [])).toThrow(
            "Expected no arguments",
        );
    });

    it("checks names", () => {
        expect(() => requireValidName("site")).not.toThrow();
        expect(() => requireValidName("Site")).toThrow(/Invalid name "Site"/);
    });

    it("reads limits", () => {
        expect(parseLimit("120", false)).toBe(120);
        expect(parseLimit(undefined, true)).toBeNull();
        expect(parseLimit(undefined, false)).toBeUndefined();
        expect(() => parseLimit("0", false)).toThrow(CliError);
        expect(() => parseLimit("1.5", false)).toThrow(CliError);
        expect(() => parseLimit("5", true)).toThrow(
            "Pass only one of --limit or --unlimited",
        );
    });

    it("reads lanes", () => {
        expect(parseLane("priority")).toBe("priority");
        expect(parseLane("bulk")).toBe("bulk");
        expect(parseLane(undefined)).toBeUndefined();
        expect(() => parseLane("fast")).toThrow(
            'Invalid lane "fast": use priority or bulk',
        );
    });
});
