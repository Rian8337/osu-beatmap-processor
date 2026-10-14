import { ConfigError } from "@/config/config";
import { BaselineError } from "@/database/baseline";
import { DrizzleQueryError } from "drizzle-orm";
import { getErrorMessage } from "@/utils/getErrorMessage";
import type { CliOutput } from "./types";

export const consoleOutput: CliOutput = {
    info: (line) => console.log(line),
    error: (line) => console.error(line),
};

export const reloadReminder =
    "The running service applies changes within KEY_RELOAD_INTERVAL_SECONDS (default 30 s), or immediately after `pm2 sendSignal SIGHUP <app>`.";

/**
 * Describes an unexpected failure for the operator. Only Drizzle's query error embeds the bound parameters of the failed
 * query (for example a key hash) in its message, so for that error only the driver's cause is shown, or a fixed
 * message if there is none. Any other error is shown as `name: message`.
 */
export function describeFailure(error: unknown): string {
    if (error instanceof ConfigError || error instanceof BaselineError) {
        return error.message;
    }

    if (error instanceof DrizzleQueryError) {
        return error.cause === undefined
            ? "The database query failed"
            : getErrorMessage(error.cause);
    }

    return error instanceof Error
        ? `${error.name}: ${error.message}`
        : "The command failed unexpectedly";
}
