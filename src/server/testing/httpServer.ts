import { createServer, type RequestListener } from "node:http";

/**
 * A plain HTTP server on 127.0.0.1 for a test. Disposing closes it, including connections still waiting for a
 * response.
 */
export interface TestHttpServer extends AsyncDisposable {
    /**
     * Base URL without a trailing slash.
     */
    readonly url: string;
}

export function startHttpServer(
    handler: RequestListener,
): Promise<TestHttpServer> {
    const server = createServer(handler);

    return new Promise((resolve, reject) => {
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();

            if (!address || typeof address === "string") {
                reject(new Error("Server has no TCP address"));
                return;
            }

            resolve({
                url: `http://127.0.0.1:${address.port.toString()}`,
                [Symbol.asyncDispose]: () =>
                    new Promise<void>((done) => {
                        server.closeAllConnections();
                        server.close(() => done());
                    }),
            });
        });
    });
}
