export enum HttpMethod {
    Get = "get",
    Post = "post",
}

/**
 * A route registered by a method decorator.
 */
export interface RouteDefinition {
    readonly path: string;
    readonly method: HttpMethod;
    readonly handlerName: string;
}

function createRouteDecorator(method: HttpMethod) {
    return (path: string): MethodDecorator =>
        (target, propertyKey) => {
            // Reflect metadata is untyped; this decorator is the only writer of "routes".
            const routes =
                (Reflect.getMetadata("routes", target.constructor) as
                    | RouteDefinition[]
                    | undefined) ?? [];

            Reflect.defineMetadata(
                "routes",
                routes.concat({
                    path,
                    method,
                    handlerName: propertyKey.toString(),
                }),
                target.constructor,
            );
        };
}

/**
 * Marks a method as a GET handler. The path is appended to the controller's base path; use `""` for the base
 * path itself.
 */
export const Get = createRouteDecorator(HttpMethod.Get);

/**
 * Marks a method as a POST handler. The path is appended to the controller's base path; use `""` for the base
 * path itself.
 */
export const Post = createRouteDecorator(HttpMethod.Post);
