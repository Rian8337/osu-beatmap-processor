import { loadEnvFile } from "process";

/**
 * Loads environment variables from a `.env` file based on the current `NODE_ENV` value.
 *
 * If this is called in a Continuous Integration environment, no file will be loaded.
 *
 * @param silent Whether a missing `.env` file will be logged as a warning. Defaults to `false`.
 */
export function loadEnvironmentVariables(silent = false) {
    if (!process.env.CI) {
        const nodeEnv = process.env.NODE_ENV ?? "development";

        try {
            loadEnvFile(`.env.${nodeEnv}`);
        } catch {
            // Gracefully ignore missing files so the application can boot using OS variables.
            if (!silent) {
                console.warn(
                    `[Env] No .env.${nodeEnv} file found. Relying on system environment variables.`,
                );
            }
        }
    }
}
