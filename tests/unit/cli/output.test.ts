import { describeFailure } from "@/cli/output";
import { BaselineError } from "@/database/baseline";
import { DatabaseUnavailableError } from "@/database/errors";
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

    it("shows the cause of a failed service read, but never a Drizzle query error's parameters", () => {
        expect(
            describeFailure(
                new DatabaseUnavailableError(new Error("connection refused")),
            ),
        ).toBe("Database unavailable: connection refused");
        expect(
            describeFailure(
                new DatabaseUnavailableError(
                    new DrizzleQueryError(
                        "select",
                        ["secret-hash"],
                        new Error("connection terminated"),
                    ),
                ),
            ),
        ).toBe("Database unavailable: connection terminated");
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
