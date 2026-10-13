import { injectable } from "tsyringe";
import type { constructor } from "tsyringe/dist/typings/types";

/**
 * Marks a class as a controller.
 *
 * @param basePath The path prefix of the controller's routes, e.g. `/performance`.
 */
export function Controller(basePath: string): ClassDecorator {
    return (target) => {
        // ClassDecorator types its target as Function; tsyringe needs a constructor type.
        const targetConstructor = target as unknown as constructor<unknown>;

        Reflect.defineMetadata("basePath", basePath, targetConstructor);

        // Reflect metadata is untyped; this decorator is the only writer of "controllers".
        const controllers =
            (Reflect.getMetadata("controllers", globalThis) as
                | constructor<unknown>[]
                | undefined) ?? [];

        Reflect.defineMetadata(
            "controllers",
            controllers.concat(targetConstructor),
            globalThis,
        );

        injectable()(targetConstructor);
    };
}
