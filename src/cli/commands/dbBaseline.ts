import { expectPositionals, parseArguments } from "@/cli/arguments";
import { CliError } from "@/cli/errors";
import type { Command } from "@/cli/types";
import { BaselineError, baselineDatabase } from "@/database/baseline";

/**
 * Records the pre-rewrite schema as migrated, once, before the rewrite first starts against an existing database.
 */
export const dbBaseline: Command = (args) => {
    const { positionals } = parseArguments(args, {});

    expectPositionals(positionals, []);

    return async ({ db, migrationsFolder, output }) => {
        try {
            await baselineDatabase(db, migrationsFolder);
        } catch (e) {
            if (e instanceof BaselineError) {
                throw new CliError(e.message);
            }

            throw e;
        }

        output.info(
            "Recorded the baseline migration as applied. Start the service (or run any other command) to apply the remaining migrations.",
        );
    };
};
