import { injectable, type InjectionToken } from "tsyringe";
import type { constructor } from "tsyringe/dist/typings/types";

/**
 * Marks a class to be injectable with the given token.
 *
 * Unlike tsyringe's {@link injectable}, providing a token does not register the class. The token is stored as
 * metadata so that `registerDependencies` can register the class to a specific container.
 *
 * @param token The injection token representing the class.
 */
export function Injectable(token: InjectionToken): ClassDecorator {
    return (target) => {
        // ClassDecorator types its target as Function; tsyringe needs a constructor type.
        const targetConstructor = target as unknown as constructor<unknown>;

        Reflect.defineMetadata("registrationToken", token, target);

        // Reflect metadata is untyped; this decorator is the only writer of "classes".
        const classes =
            (Reflect.getMetadata("classes", globalThis) as
                | constructor<unknown>[]
                | undefined) ?? [];

        Reflect.defineMetadata(
            "classes",
            classes.concat(targetConstructor),
            globalThis,
        );

        injectable()(targetConstructor);
    };
}
