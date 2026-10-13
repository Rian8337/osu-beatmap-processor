import { ServiceUnavailableError } from "@/server";

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
