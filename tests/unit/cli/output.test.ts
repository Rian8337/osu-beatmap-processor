import { describeFailure } from "@/cli/output";
import { BaselineError } from "@/database/baseline";
import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";

describe("describeFailure", () => {
    it("shows only the driver's message for a Drizzle query error", () => {
        const error = new DrizzleQueryError(
            "insert into api_keys",
            ["secret-hash"],
            new Error("connection terminated"),
        );

        expect(error.message).toContain("secret-hash");
        expect(describeFailure(error)).toBe("connection terminated");
        expect(
            describeFailure(
                new DrizzleQueryError(
                    "insert",
                    ["secret-hash"],
                    undefined as never,
                ),
            ),
        ).toBe("The database query failed");
    });

    it("shows the name and message of any other error", () => {
        expect(describeFailure(new TypeError("bad folder"))).toBe(
            "TypeError: bad folder",
        );
        expect(describeFailure(new BaselineError("no history"))).toBe(
            "no history",
        );
    });

    it("uses a fixed text for a value that is not an error", () => {
        expect(describeFailure("boom")).toBe("The command failed unexpectedly");
    });
});
