import { isValidKeyName } from "@/access/names";
import type { Lane } from "@/osu/errors";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { CliError } from "./errors";

/**
 * Parses a command's arguments with `util.parseArgs`: unknown options are errors, and positionals are allowed.
 * Argument errors (unknown option, missing value) become {@link CliError}s.
 */
export function parseArguments<const T extends ParseArgsOptionsConfig>(
    args: string[],
    options: T,
) {
    try {
        return parseArgs<{
            args: string[];
            options: T;
            allowPositionals: true;
            strict: true;
        }>({ args, options, allowPositionals: true, strict: true });
    } catch (e) {
        if (
            e instanceof TypeError &&
            "code" in e &&
            typeof e.code === "string" &&
            e.code.startsWith("ERR_PARSE_ARGS")
        ) {
            throw new CliError(e.message);
        }

        throw e;
    }
}

/**
 * Checks that exactly the named positional arguments were given.
 */
export function expectPositionals(
    positionals: string[],
    names: readonly string[],
): string[] {
    if (positionals.length !== names.length) {
        throw new CliError(
            names.length === 0
                ? "Expected no arguments"
                : `Expected ${names.map((name) => `<${name}>`).join(" ")}`,
        );
    }

    return positionals;
}

export function requireValidName(name: string): void {
    if (!isValidKeyName(name)) {
        throw new CliError(
            `Invalid name "${name}": use lowercase letters, digits, and hyphens, not starting with a hyphen`,
        );
    }
}

/**
 * Reads `--limit`/`--unlimited`: a positive whole number, `null` for unlimited, or `undefined` if neither was given.
 */
export function parseLimit(
    limit: string | undefined,
    unlimited: boolean,
): number | null | undefined {
    if (limit !== undefined && unlimited) {
        throw new CliError("Pass only one of --limit or --unlimited");
    }

    if (unlimited) {
        return null;
    }

    if (limit === undefined) {
        return undefined;
    }

    const value = Number(limit);

    if (!Number.isInteger(value) || value < 1) {
        throw new CliError(
            `Invalid limit "${limit}": expected a whole number of requests per minute`,
        );
    }

    return value;
}

/**
 * Reads `--lane`: `priority`, `bulk`, or `undefined` if it was not given.
 */
export function parseLane(lane: string | undefined): Lane | undefined {
    if (lane === undefined || lane === "priority" || lane === "bulk") {
        return lane;
    }

    throw new CliError(`Invalid lane "${lane}": use priority or bulk`);
}
