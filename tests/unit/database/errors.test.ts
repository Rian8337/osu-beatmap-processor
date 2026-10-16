import {
    DatabaseUnavailableError,
    describeDatabaseFailure,
    readOrUnavailable,
} from "@/database/errors";
import { silenceConsoleErrors } from "@test/utils/silenceConsoleErrors";
import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";

describe("readOrUnavailable", () => {
    it("returns the result of a query that succeeds, without logging", async () => {
        const logged = silenceConsoleErrors();

        expect(await readOrUnavailable(() => Promise.resolve(42))).toBe(42);
        expect(logged).not.toHaveBeenCalled();
    });

    it("logs the cause once and throws DatabaseUnavailableError with it", async () => {
        const logged = silenceConsoleErrors();
        const cause = new Error("connection refused");

        const failure = await readOrUnavailable(() =>
            Promise.reject(cause),
        ).catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(DatabaseUnavailableError);
        expect((failure as DatabaseUnavailableError).cause).toBe(cause);
        expect(logged).toHaveBeenCalledOnce();
        expect(logged).toHaveBeenCalledWith(
            "Database read failed:",
            "connection refused",
        );
    });

    it("logs only the driver's message for a Drizzle query error, never its bound parameters", async () => {
        const logged = silenceConsoleErrors();
        const error = new DrizzleQueryError(
            "select * from beatmap where file_md5 = $1",
            ["secret-param"],
            new Error("connection terminated"),
        );

        await expect(
            readOrUnavailable(() => Promise.reject(error)),
        ).rejects.toBeInstanceOf(DatabaseUnavailableError);
        expect(logged).toHaveBeenCalledOnce();
        expect(logged).toHaveBeenCalledWith(
            "Database read failed:",
            "connection terminated",
        );
    });
});

describe("describeDatabaseFailure", () => {
    it("uses a fixed text for a Drizzle query error without a cause", () => {
        expect(
            describeDatabaseFailure(
                new DrizzleQueryError("x", ["p"], undefined as never),
            ),
        ).toBe("The database query failed");
    });
});
