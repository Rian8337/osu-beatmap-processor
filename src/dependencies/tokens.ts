import type { Config } from "@/config/config";
import type { Database } from "@/database/types";
import type { IOsuGateway } from "@/osu/IOsuGateway";
import type { OsuGatewayOptions } from "@/osu/OsuGateway";
import type { IBeatmapRepository } from "@/repositories/IBeatmapRepository";
import type { IBeatmapsetRepository } from "@/repositories/IBeatmapsetRepository";
import type { ICursorRepository } from "@/repositories/ICursorRepository";
import type { InjectionToken } from "tsyringe";

/**
 * Tokens for dependency injection. Each token is added by the task that introduces its interface.
 *
 * `Symbol.for(...) as InjectionToken<T>` is how tsyringe gives a symbol token its type.
 */
export const dependencyTokens = {
    config: Symbol.for("config") as InjectionToken<Config>,
    db: Symbol.for("db") as InjectionToken<Database>,
    osuGatewayOptions: Symbol.for(
        "osuGatewayOptions",
    ) as InjectionToken<OsuGatewayOptions>,
    osuGateway: Symbol.for("osuGateway") as InjectionToken<IOsuGateway>,
    beatmapRepository: Symbol.for(
        "beatmapRepository",
    ) as InjectionToken<IBeatmapRepository>,
    beatmapsetRepository: Symbol.for(
        "beatmapsetRepository",
    ) as InjectionToken<IBeatmapsetRepository>,
    cursorRepository: Symbol.for(
        "cursorRepository",
    ) as InjectionToken<ICursorRepository>,
} satisfies Record<string, InjectionToken<unknown>>;
