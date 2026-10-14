import { dbBaseline } from "./commands/dbBaseline";
import { fixDates } from "./commands/fixDates";
import {
    createKey,
    listKeys,
    revokeKey,
    showKey,
    updateKey,
} from "./commands/key";
import { populateCache } from "./commands/populateCache";
import { CliError } from "./errors";
import { describeFailure } from "./output";
import type {
    CliDependencies,
    CliOutput,
    CommandAction,
    CommandDefinition,
} from "./types";

export const commands = new Map<string, CommandDefinition>([
    ["key create", { buildAction: createKey, requiresMigrations: true }],
    ["key update", { buildAction: updateKey, requiresMigrations: true }],
    ["key revoke", { buildAction: revokeKey, requiresMigrations: true }],
    ["key list", { buildAction: listKeys, requiresMigrations: true }],
    ["key show", { buildAction: showKey, requiresMigrations: true }],
    // Runs before any migration: it is what lets migrations run on a pre-rewrite database.
    ["db-baseline", { buildAction: dbBaseline, requiresMigrations: false }],
    [
        "populate-cache",
        { buildAction: populateCache, requiresMigrations: true },
    ],
    ["fix-dates", { buildAction: fixDates, requiresMigrations: true }],
]);

export const usage = `Usage: node dist/cli.mjs <command>

  key create <name> --lane <priority|bulk> (--limit <per-minute> | --unlimited)
  key update <name> [--lane <priority|bulk>] [--limit <per-minute> | --unlimited]
  key revoke <name>
  key list
  key show <name>

  db-baseline
  populate-cache [--files <dump directory>] [--move] [--restart]
  fix-dates [--restart]`;

/**
 * Checks the command name and its arguments. Needs no configuration or database, so a mistyped command reports usage
 * before anything is opened.
 *
 * @returns The action to run, or `undefined` after printing usage or the argument error.
 */
export function parseCli(
    argv: readonly string[],
    output: CliOutput,
):
    | { readonly action: CommandAction; readonly requiresMigrations: boolean }
    | undefined {
    const [first = "", second = ""] = argv;
    const twoWordCommand = commands.get(`${first} ${second}`);
    const command = twoWordCommand ?? commands.get(first);

    if (!command) {
        output.error(usage);

        return undefined;
    }

    try {
        return {
            action: command.buildAction(argv.slice(twoWordCommand ? 2 : 1)),
            requiresMigrations: command.requiresMigrations,
        };
    } catch (e) {
        if (e instanceof CliError) {
            output.error(e.message);

            return undefined;
        }

        throw e;
    }
}

/**
 * Runs a parsed command.
 *
 * @returns The exit code: 0 on success, 1 for a {@link CliError} or any other failure.
 */
export async function runAction(
    action: CommandAction,
    deps: CliDependencies,
): Promise<number> {
    try {
        await action(deps);

        return 0;
    } catch (e) {
        if (e instanceof CliError) {
            deps.output.error(e.message);

            return 1;
        }

        // Never print the raw error: a database error carries the bound parameters, such as a key hash.
        deps.output.error(`The command failed: ${describeFailure(e)}`);

        return 1;
    }
}

/**
 * Parses and runs one CLI command, without migrating (tests pass migrated databases).
 *
 * @returns The exit code: 0 on success, 1 for an unknown command or a {@link CliError}.
 */
export async function runCli(
    argv: readonly string[],
    deps: CliDependencies,
): Promise<number> {
    const parsed = parseCli(argv, deps.output);

    return parsed ? await runAction(parsed.action, deps) : 1;
}
