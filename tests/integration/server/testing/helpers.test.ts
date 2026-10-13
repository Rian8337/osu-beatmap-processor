import pg from "pg";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { freePort } from "@/server/testing/ports";
import { startTestPostgres } from "@/server/testing/postgres";
import { startProcess } from "@/server/testing/process";

const fixture = (name: string) =>
    fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

describe("e2e helpers", () => {
    it("starts a process, waits until it is ready, and collects its output", async () => {
        const port = await freePort();

        await using started = await startProcess({
            script: fixture("http-server.mjs"),
            env: { ...process.env, PORT: port.toString() },
            readyUrl: `http://127.0.0.1:${port.toString()}/ready`,
        });

        expect(started.output()).toContain(
            `fixture listening on ${port.toString()}`,
        );

        started.child.kill("SIGTERM");

        expect(await started.exited).toBe(0);
    });

    it("rejects with the output when the process exits before it is ready", async () => {
        const port = await freePort();

        await expect(
            startProcess({
                script: fixture("crash.mjs"),
                env: process.env,
                readyUrl: `http://127.0.0.1:${port.toString()}/ready`,
            }),
        ).rejects.toThrow("fixture failed to start");
    });

    it("serves an in-memory Postgres database over a socket", async () => {
        await using postgres = await startTestPostgres();
        await using connection = new AsyncDisposableStack();
        const client = new pg.Client({
            host: "127.0.0.1",
            port: postgres.port,
            user: "postgres",
            database: "postgres",
        });

        await client.connect();
        connection.defer(() => client.end());

        const result = await client.query<{ answer: number }>(
            "select 42 as answer",
        );

        expect(result.rows[0]?.answer).toBe(42);
    });
});
