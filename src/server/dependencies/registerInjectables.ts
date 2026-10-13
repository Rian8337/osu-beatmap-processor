import type { DependencyContainer, InjectionToken } from "tsyringe";
import type { constructor } from "tsyringe/dist/typings/types";

/**
 * Registers every `@Injectable` class that has been loaded as a singleton under its token. Import the app's
 * injectable classes before calling this, so their decorators have run.
 */
export function registerInjectables(container: DependencyContainer): void {
    // Reflect metadata is untyped; `Injectable` writes these values.
    const classes =
        (Reflect.getMetadata("classes", globalThis) as
            | constructor<unknown>[]
            | undefined) ?? [];

    for (const cls of classes) {
        const token = Reflect.getMetadata("registrationToken", cls) as
            | InjectionToken<unknown>
            | undefined;

        if (!token) {
            throw new Error(
                `Class ${cls.name} has no registration token; decorate it with @Injectable`,
            );
        }

        container.registerSingleton(token, cls);
    }
}
