import { sql } from "drizzle-orm";
import { createServer, type Socket } from "node:net";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
    DatabaseConnection,
    type DatabaseSettings,
} from "@/server/database/DatabaseConnection";

const settings: DatabaseSettings = {
    host: "127.0.0.1",
    port: 1,
    name: "postgres",
    user: "postgres",
    password: "super-secret",
};

describe("DatabaseConnection", () => {
    it("logs errors of idle pooled clients instead of throwing", async () => {
        const error = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const pool = new Pool();

        await using _connection = new DatabaseConnection(settings, {}, pool);

        expect(() =>
            pool.emit("error", new Error("terminating connection")),
        ).not.toThrow();
        expect(error).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(error.mock.calls)).toContain(
            "terminating connection",
        );
        expect(JSON.stringify(error.mock.calls)).not.toContain("super-secret");
    });

    it("fails a query when the server does not answer the connection", async () => {
        // Accepts TCP connections but never speaks the Postgres protocol.
        const sockets = new Set<Socket>();
        const server = createServer((socket) => sockets.add(socket));
        await new Promise<void>((resolve) => {
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        if (address === null || typeof address === "string") {
            throw new Error("Server has no port");
        }

        try {
            await using connection = new DatabaseConnection(
                { ...settings, port: address.port, connectionTimeoutMs: 100 },
                {},
            );

            // Drizzle wraps the driver error; the pool's timeout is the cause.
            await expect(
                connection.db.execute(sql`select 1`),
            ).rejects.toMatchObject({
                cause: { message: expect.stringMatching(/timeout/i) },
            });
        } finally {
            for (const socket of sockets) {
                socket.destroy();
            }
            await new Promise((resolve) => server.close(resolve));
        }
    });
});
