import { GracefulServer } from "@/server/runtime/GracefulServer";
import express from "express";
import { Agent, request } from "node:http";
import { describe, expect, it } from "vitest";

function get(agent: Agent, port: number): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        request({ agent, port, host: "127.0.0.1", path: "/slow" }, (res) => {
            res.resume();
            res.on("end", () => resolve(res.headers.connection));
        })
            .on("error", reject)
            .end();
    });
}

describe("GracefulServer", () => {
    it("shuts down while keep-alive clients keep sending requests", async () => {
        const server = new GracefulServer();
        let stop = false;
        let requests = 0;
        let disposed: Promise<void> | undefined;
        const app = express()
            .use(server.middleware)
            .get("/slow", (_req, res) => {
                // Shutdown starts while this request is in flight, so its connection finishes the response as
                // keep-alive and then sits idle (the clients stop sending); only the server can close it. Doing it
                // from the handler makes this happen on every run instead of depending on timing.
                if (++requests === 5) {
                    stop = true;
                    disposed = server[Symbol.asyncDispose]();
                }

                setTimeout(() => res.send("ok"), 0);
            });

        const port = await server.listen(app, 0);

        // Two sockets, so that the other one being idle or closed cannot mask a connection that stays open.
        using agent = keepAliveAgent(2);

        const loop = async () => {
            while (!stop) {
                try {
                    await get(agent, port);
                } catch {
                    return;
                }
            }
        };

        const clients = [loop(), loop()];

        await expect.poll(() => stop).toBe(true);

        await expect(
            Promise.race([
                disposed,
                new Promise((resolve) => setTimeout(resolve, 1000, "timeout")),
            ]),
        ).resolves.toBeUndefined();

        await Promise.all(clients);
    });

    it("finishes the in-flight request, then closes its keep-alive connection", async () => {
        const server = new GracefulServer();
        let markReceived: () => void = () => undefined;
        const received = new Promise<void>((resolve) => {
            markReceived = resolve;
        });
        let requests = 0;
        const app = express()
            .use(server.middleware)
            .get("/slow", (_req, res) => {
                if (++requests === 2) {
                    markReceived();
                }

                setTimeout(() => res.send("ok"), 100);
            });

        const port = await server.listen(app, 0);

        using agent = keepAliveAgent();

        await get(agent, port);

        const inFlight = get(agent, port);

        await received;

        const disposed = server[Symbol.asyncDispose]();

        // The in-flight request still completes (it began before shutdown, so it says keep-alive), and disposal
        // finishes because the connection is closed afterwards.
        await expect(
            Promise.race([
                Promise.all([inFlight, disposed]).then(([header]) => header),
                new Promise((resolve) => setTimeout(resolve, 1000, "timeout")),
            ]),
        ).resolves.toBe("keep-alive");
    });

    it("disposing a server that never listened does nothing", async () => {
        await expect(
            new GracefulServer()[Symbol.asyncDispose](),
        ).resolves.toBeUndefined();
    });

    it("binds to the given host", async () => {
        await using server = new GracefulServer();
        const app = express().get("/", (_req, res) => {
            res.send("ok");
        });

        const port = await server.listen(app, 0, "127.0.0.1");
        const response = await fetch(`http://127.0.0.1:${port.toString()}/`);

        expect(await response.text()).toBe("ok");
        // @ts-expect-error: reading the private server to check its address.
        expect(server.server.address().address).toBe("127.0.0.1");
    });
});

function keepAliveAgent(maxSockets = 1): Agent & Disposable {
    const agent = new Agent({ keepAlive: true, maxSockets });

    return Object.assign(agent, { [Symbol.dispose]: () => agent.destroy() });
}
