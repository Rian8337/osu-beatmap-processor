import type { Config } from "@/config/config";
import type { Database } from "@/database/types";
import type { IOsuGateway } from "@/osu/IOsuGateway";

export interface CliOutput {
    info(line: string): void;
    error(line: string): void;
}

export interface CliDependencies {
    readonly output: CliOutput;
    readonly db: Database;
    readonly migrationsFolder: string;
    /** The full configuration; only commands that call osu! or write files read it. @throws {ConfigError} */
    readonly loadConfig: () => Config;
    /** A gateway with its own rate limiter. Call it once per command. */
    readonly createOsuGateway: (
        config: Config,
    ) => Pick<IOsuGateway, "getBeatmapsSince">;
    readonly sleep: (ms: number) => Promise<void>;
}

export type CommandAction = (deps: CliDependencies) => Promise<void>;

/** Checks a command's arguments without touching anything. @throws {CliError} */
export type Command = (args: string[]) => CommandAction;

export interface CommandDefinition {
    readonly buildAction: Command;
    /** Apply pending migrations before running (every command but `db-baseline`). */
    readonly requiresMigrations: boolean;
}
