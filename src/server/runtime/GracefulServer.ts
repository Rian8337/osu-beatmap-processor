import type { Express, RequestHandler } from "express";
import type { Server } from "node:http";

/**
 * An HTTP server that shuts down promptly even when clients keep their connections alive. Disposing stops
 * accepting connections, closes idle ones, and makes every remaining response carry `Connection: close`, so
 * each connection ends as soon as its in-flight response is done.
 *
 * `http.Server.close()` alone leaves busy keep-alive connections open, and they keep serving requests.
 */
export class GracefulServer implements AsyncDisposable {
    private server: Server | undefined;
    private closing = false;

    /**
     * Middleware to install first in the application, so responses can announce the connection closing.
     */
    readonly middleware: RequestHandler = (_req, res, next) => {
        if (this.closing) {
            res.setHeader("Connection", "close");
        } else {
            // A request that was in flight when shutdown began finishes with a keep-alive connection; close it
            // once it is idle. `setImmediate` lets Node mark the connection idle first.
            res.once("finish", () => {
                if (this.closing) {
                    setImmediate(() => this.server?.closeIdleConnections());
                }
            });
        }

        next();
    };

    /**
     * Starts listening, and resolves with the port that is bound (useful when `port` is 0). Without `host`, Node's
     * default applies (every interface).
     */
    listen(app: Express, port: number, host?: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const onListening = (error?: Error) => {
                const address = server.address();

                if (error || !address || typeof address === "string") {
                    reject(error ?? new Error("Server has no TCP address"));
                } else {
                    resolve(address.port);
                }
            };
            const server =
                host === undefined
                    ? app.listen(port, onListening)
                    : app.listen(port, host, onListening);

            this.server = server;
        });
    }

    [Symbol.asyncDispose](): Promise<void> {
        const server = this.server;

        if (!server?.listening) {
            return Promise.resolve();
        }

        this.closing = true;

        return new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
            server.closeIdleConnections();
        });
    }
}
