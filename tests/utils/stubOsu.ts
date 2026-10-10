import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";

export interface StubOsu extends AsyncDisposable {
    /** Base URL without a trailing slash; the API is at `${url}/api`, files at `${url}/osu`. */
    readonly url: string;
    /** Every request path with its query string, in order. */
    readonly requests: string[];
    handle(handler: (req: IncomingMessage, res: ServerResponse) => void): void;
}

export function startStubOsu(): Promise<StubOsu> {
    const requests: string[] = [];
    let handler = (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(500).end();
    };
    const server = createServer((req, res) => {
        requests.push(req.url ?? "");
        handler(req, res);
    });

    return new Promise((resolve, reject) => {
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();

            if (!address || typeof address === "string") {
                reject(new Error("Stub osu! server has no TCP address"));
                return;
            }

            resolve({
                url: `http://127.0.0.1:${address.port.toString()}`,
                requests,
                handle: (next) => {
                    handler = next;
                },
                [Symbol.asyncDispose]: () =>
                    new Promise<void>((done) => {
                        server.closeAllConnections();
                        server.close(() => {
                            done();
                        });
                    }),
            });
        });
    });
}
