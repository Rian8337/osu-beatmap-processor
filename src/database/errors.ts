import { ServiceUnavailableError } from "@/server";
import { getErrorMessage } from "@/utils/getErrorMessage";
import { DrizzleQueryError } from "drizzle-orm";

/**
 * A database read failed. Answered as `503` without asking osu!: during an outage every request would otherwise
 * become an osu! call and exhaust the budget within seconds.
 */
export class DatabaseUnavailableError extends ServiceUnavailableError {
    constructor(cause: unknown) {
        super("Database unavailable", 5);
        this.cause = cause;
    }
}

/**
 * Describes a database failure for a log line or the operator. Only Drizzle's query error embeds the bound parameters
 * of the failed query in its message, so for that error only the driver's cause is shown, or a fixed message if there
 * is none.
 */
export function describeDatabaseFailure(error: unknown): string {
    if (error instanceof DrizzleQueryError) {
        return error.cause === undefined
            ? "The database query failed"
            : getErrorMessage(error.cause);
    }

    return getErrorMessage(error);
}

/**
 * Runs a read query, turning a database failure into {@link DatabaseUnavailableError}. The cause is logged here, once
 * per failure, because the 503 answer carries no detail.
 */
export async function readOrUnavailable<T>(
    query: () => Promise<T>,
): Promise<T> {
    try {
        return await query();
    } catch (e) {
        console.error("Database read failed:", describeDatabaseFailure(e));

        throw new DatabaseUnavailableError(e);
    }
}
