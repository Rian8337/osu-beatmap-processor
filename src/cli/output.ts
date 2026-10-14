import { ConfigError } from "@/config/config";
import { BaselineError } from "@/database/baseline";
import { getErrorMessage } from "@/utils/getErrorMessage";
import type { CliOutput } from "./types";

export const consoleOutput: CliOutput = {
    info: (line) => console.log(line),
    error: (line) => console.error(line),
};

export const reloadReminder =
    "The running service applies changes within KEY_RELOAD_INTERVAL_SECONDS (default 30 s), or immediately after `pm2 sendSignal SIGHUP <app>`.";

/**
 * Describes an unexpected failure for the operator. Drizzle's own message embeds the bound parameters of the failed
 * query (for example a key hash), so only the driver's cause is shown, or a fixed message if there is none.
 */
export function describeFailure(error: unknown): string {
    if (error instanceof ConfigError || error instanceof BaselineError) {
        return error.message;
    }

    return error instanceof Error && error.cause !== undefined
        ? getErrorMessage(error.cause)
        : "The command failed unexpectedly";
}
