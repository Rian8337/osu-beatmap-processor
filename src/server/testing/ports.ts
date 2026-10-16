import { createServer } from "node:net";

/**
 * Finds a TCP port that is free on 127.0.0.1 right now.
 */
export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer().listen(0, "127.0.0.1", () => {
            const address = server.address();

            server.close(() =>
                typeof address === "object" && address
                    ? resolve(address.port)
                    : reject(new Error("no port")),
            );
        });
    });
}
