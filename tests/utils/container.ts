import type { Config } from "@/config/config";
import type { Database } from "@/database/types";
import { registerDependencies } from "@/dependencies/register";
import { createOsuGatewayOptions } from "@/osu/createOsuGatewayOptions";
import type { OsuGatewayOptions } from "@/osu/OsuGateway";
import { testConfig } from "@test/utils/config";
import { createTestDatabase } from "@test/utils/database";
import {
    container as globalContainer,
    type DependencyContainer,
} from "tsyringe";

/**
 * A container for a test. Disposing releases the test database unless one was passed in.
 */
export interface TestContainer extends AsyncDisposable {
    readonly container: DependencyContainer;
}

/**
 * Creates a child container with real implementations and a PGlite database (unless `db` is given).
 */
export async function createTestContainer(
    options: {
        db?: Database;
        config?: Config;
        osuGatewayOptions?: OsuGatewayOptions;
        overrides?: (container: DependencyContainer) => void;
    } = {},
): Promise<TestContainer> {
    const resources = new AsyncDisposableStack();
    const db = options.db ?? resources.use(await createTestDatabase()).db;
    const config = options.config ?? testConfig;
    const container = globalContainer.createChildContainer();

    registerDependencies(container, {
        config,
        db,
        osuGatewayOptions:
            options.osuGatewayOptions ?? createOsuGatewayOptions(config),
    });
    options.overrides?.(container);

    return { container, [Symbol.asyncDispose]: () => resources.disposeAsync() };
}
