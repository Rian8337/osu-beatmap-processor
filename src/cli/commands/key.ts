import { generateApiKey, hashApiKey } from "@/access/keys";
import type { KeyListing } from "@/access/types";
import {
    expectPositionals,
    parseArguments,
    parseLane,
    parseLimit,
    requireValidName,
} from "@/cli/arguments";
import { CliError } from "@/cli/errors";
import { reloadReminder } from "@/cli/output";
import { formatTable } from "@/cli/table";
import type { Command } from "@/cli/types";
import type { Lane } from "@/osu/errors";
import { KeyRepository } from "@/repositories/KeyRepository";

async function requireActiveKey(
    repository: KeyRepository,
    name: string,
): Promise<KeyListing> {
    const key = await repository.findByName(name);

    if (!key) {
        throw new CliError(`No key named "${name}"`);
    }

    if (key.revokedAt) {
        throw new CliError(`Key ${name} is revoked`);
    }

    return key;
}

function describeLimit(key: Pick<KeyListing, "rateLimitPerMinute">): string {
    return key.rateLimitPerMinute === null
        ? "unlimited"
        : `${key.rateLimitPerMinute.toString()}/min`;
}

export const createKey: Command = (args) => {
    const { values, positionals } = parseArguments(args, {
        lane: { type: "string" },
        limit: { type: "string" },
        unlimited: { type: "boolean", default: false },
    });
    const [name = ""] = expectPositionals(positionals, ["name"]);

    requireValidName(name);

    const lane = parseLane(values.lane);

    if (lane === undefined) {
        throw new CliError("Pass --lane priority or --lane bulk");
    }

    const rateLimitPerMinute = parseLimit(values.limit, values.unlimited);

    if (rateLimitPerMinute === undefined) {
        throw new CliError("Pass --limit <per-minute> or --unlimited");
    }

    return async ({ db, output }) => {
        const repository = new KeyRepository(db);

        if (await repository.findByName(name)) {
            throw new CliError(`A key named "${name}" already exists`);
        }

        const key = generateApiKey();

        await repository.insert({
            name,
            keyHash: hashApiKey(key),
            lane,
            rateLimitPerMinute,
        });

        output.info(
            `Created key ${name} (${lane} lane, ${describeLimit({ rateLimitPerMinute })}).`,
        );
        output.info(`Key: ${key}`);
        output.info("Store it now; it cannot be shown again.");
        output.info(reloadReminder);
    };
};

export const updateKey: Command = (args) => {
    const { values, positionals } = parseArguments(args, {
        lane: { type: "string" },
        limit: { type: "string" },
        unlimited: { type: "boolean", default: false },
    });
    const [name = ""] = expectPositionals(positionals, ["name"]);
    const changes: { lane?: Lane; rateLimitPerMinute?: number | null } = {};
    const lane = parseLane(values.lane);
    const rateLimitPerMinute = parseLimit(values.limit, values.unlimited);

    if (lane !== undefined) {
        changes.lane = lane;
    }

    if (rateLimitPerMinute !== undefined) {
        changes.rateLimitPerMinute = rateLimitPerMinute;
    }

    if (Object.keys(changes).length === 0) {
        throw new CliError(
            "Nothing to update; pass --lane, --limit, or --unlimited",
        );
    }

    return async ({ db, output }) => {
        const repository = new KeyRepository(db);

        await requireActiveKey(repository, name);
        await repository.update(name, changes);

        output.info(`Updated key ${name}.`);
        output.info(reloadReminder);
    };
};

export const revokeKey: Command = (args) => {
    const { positionals } = parseArguments(args, {});
    const [name = ""] = expectPositionals(positionals, ["name"]);

    return async ({ db, output }) => {
        const repository = new KeyRepository(db);

        if (!(await repository.findByName(name))) {
            throw new CliError(`No key named "${name}"`);
        }

        if (!(await repository.revoke(name))) {
            throw new CliError(`Key ${name} is already revoked`);
        }

        output.info(`Revoked key ${name}.`);
        output.info(reloadReminder);
    };
};

export const listKeys: Command = (args) => {
    const { positionals } = parseArguments(args, {});

    expectPositionals(positionals, []);

    return async ({ db, output }) => {
        const keys = await new KeyRepository(db).list();

        if (keys.length === 0) {
            output.info("No keys.");

            return;
        }

        for (const line of formatTable(
            ["NAME", "LANE", "LIMIT", "CREATED", "REVOKED"],
            keys.map((key) => [
                key.name,
                key.lane,
                describeLimit(key),
                key.createdAt.toISOString(),
                key.revokedAt?.toISOString() ?? "-",
            ]),
        )) {
            output.info(line);
        }
    };
};

export const showKey: Command = (args) => {
    const { positionals } = parseArguments(args, {});
    const [name = ""] = expectPositionals(positionals, ["name"]);

    return async ({ db, output }) => {
        const key = await new KeyRepository(db).findByName(name);

        if (!key) {
            throw new CliError(`No key named "${name}"`);
        }

        output.info(`Name:     ${key.name}`);
        output.info(`Lane:     ${key.lane}`);
        output.info(`Limit:    ${describeLimit(key)}`);
        output.info(`Created:  ${key.createdAt.toISOString()}`);
        output.info(`Revoked:  ${key.revokedAt?.toISOString() ?? "-"}`);
    };
};
