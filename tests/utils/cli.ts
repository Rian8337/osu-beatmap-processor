import type { CliDependencies, CliOutput } from "@/cli/types";
import type { Database } from "@/database/types";
import { testConfig } from "@test/utils/config";
import { migrationsFolder } from "@test/utils/database";

export interface CapturedOutput extends CliOutput {
    readonly lines: string[];
    readonly errors: string[];
}

export function captureOutput(): CapturedOutput {
    const lines: string[] = [];
    const errors: string[] = [];

    return {
        lines,
        errors,
        info: (line) => lines.push(line),
        error: (line) => errors.push(line),
    };
}

/**
 * CLI dependencies over a test database. osu! is unreachable unless `createOsuGateway` is overridden, and sleeping
 * returns at once.
 */
export function createCliDependencies(
    db: Database,
    overrides: Partial<CliDependencies> = {},
): CliDependencies & { output: CapturedOutput } {
    return {
        db,
        migrationsFolder,
        loadConfig: () => testConfig,
        createOsuGateway: () => {
            throw new Error("This test does not use osu!");
        },
        sleep: () => Promise.resolve(),
        ...overrides,
        output: captureOutput(),
    };
}
