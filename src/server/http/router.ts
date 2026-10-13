import { Router, type RequestHandler } from "express";
import type { RouteDefinition } from "@/server/decorators/routes";
import { getContainer } from "@/server/dependencies/container";

type ControllerClass = new () => Record<string, RequestHandler>;

/**
 * Creates a router from the routes declared on controllers. Import the app's controllers before calling this, so
 * their decorators have registered them.
 */
export function createRouter(container = getContainer()): Router {
    const router = Router();

    // Reflect metadata is untyped; the @Controller and route decorators write these values.
    const controllers =
        (Reflect.getMetadata("controllers", globalThis) as
            | ControllerClass[]
            | undefined) ?? [];

    for (const Controller of controllers) {
        const basePath = Reflect.getMetadata("basePath", Controller) as
            | string
            | undefined;

        if (basePath === undefined) {
            throw new Error(
                `Controller ${Controller.name} has no base path; decorate it with @Controller`,
            );
        }

        const routes =
            (Reflect.getMetadata("routes", Controller) as
                | RouteDefinition[]
                | undefined) ?? [];

        if (!container.isRegistered(Controller)) {
            container.registerSingleton(Controller);
        }

        const instance = container.resolve(Controller);

        for (const route of routes) {
            const handler = instance[route.handlerName];

            if (!handler) {
                throw new Error(
                    `${Controller.name}.${route.handlerName} does not exist`,
                );
            }

            router[route.method](
                `${basePath}${route.path}`,
                handler.bind(instance),
            );
        }
    }

    return router;
}
