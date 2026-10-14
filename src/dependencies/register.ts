import type { Config } from "@/config/config";
import type { Database } from "@/database/types";
import type { OsuGatewayOptions } from "@/osu/OsuGateway";
import { registerInjectables } from "@/server";
import type { DependencyContainer } from "tsyringe";
// Load injectable classes so their metadata is registered.
import "@/osu/OsuGateway";
import "@/repositories";
import "@/services";
import { dependencyTokens } from "./tokens";

/**
 * Instances created at startup rather than by the container.
 */
export interface RuntimeInstances {
    readonly config: Config;
    readonly db: Database;
    readonly osuGatewayOptions: OsuGatewayOptions;
}

/**
 * Registers runtime instances and every `@Injectable` class to a container.
 */
export function registerDependencies(
    container: DependencyContainer,
    instances: RuntimeInstances,
): void {
    container.registerInstance(dependencyTokens.config, instances.config);
    container.registerInstance(dependencyTokens.db, instances.db);
    container.registerInstance(
        dependencyTokens.osuGatewayOptions,
        instances.osuGatewayOptions,
    );
    registerInjectables(container);
}
