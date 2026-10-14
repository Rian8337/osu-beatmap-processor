import { createFakeOsuHandler } from "@test/fixtures/osu/fakeOsu";
import { createGoldenOsuState } from "@test/fixtures/osu/beatmaps";
import { startStubOsu } from "@test/utils/stubOsu";
import { freePort, startProcess, startTestPostgres } from "@/server/testing";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120_000 });

const script = fileURLToPath(new URL("../../dist/index.mjs", import.meta.url));
const bulkKey = "e2e-bulk-key";

async function buildEnvironment(
    postgresPort: number,
    osuUrl: string,
    directory: string,
) {
    const port = await freePort();

    return {
        port,
        env: {
            PATH: process.env.PATH,
            // Skips `.env.*` files: the test passes every variable.
            CI: "1",
            EXPRESS_PORT: port.toString(),
            POSTGRES_HOSTNAME: "127.0.0.1",
            POSTGRES_PORT: postgresPort.toString(),
            POSTGRES_DB_NAME: "postgres",
            POSTGRES_USERNAME: "postgres",
            OSU_API_KEY: "e2e-osu-key",
            INTERNAL_SERVER_KEY: "e2e-priority-key",
            BULK_SERVER_KEY: bulkKey,
            OSU_API_BASE_URL: `${osuUrl}/api`,
            OSU_FILE_BASE_URL: `${osuUrl}/osu`,
            BEATMAP_FILE_DIRECTORY: directory,
        },
    };
}

describe("dist/index.mjs", () => {
    it("serves the dpp processors' contract and shuts down cleanly", async () => {
        await using postgres = await startTestPostgres();
        await using osu = await startStubOsu();
        const state = createGoldenOsuState();
        const directory = await mkdtemp(join(tmpdir(), "e2e-beatmaps-"));

        osu.handle(createFakeOsuHandler(state));

        try {
            const { port, env } = await buildEnvironment(
                postgres.port,
                osu.url,
                directory,
            );
            const base = `http://127.0.0.1:${port.toString()}/api/beatmap`;
            await using server = await startProcess({
                script,
                env,
                readyUrl: `${base}/health`,
            });

            expect(server.output()).toContain(
                "[beatmap-service] Listening on port",
            );

            const beatmap = await fetch(
                `${base}/getbeatmap?id=75&key=${bulkKey}`,
            );

            expect(beatmap.status).toBe(200);
            expect(await beatmap.json()).toMatchObject({
                beatmap_id: "75",
                file_md5: state.beatmaps[0]?.file_md5,
            });

            const missing = await fetch(
                `${base}/getbeatmap?id=999&key=${bulkKey}`,
            );

            expect(missing.status).toBe(404);
            expect(await missing.json()).toEqual({
                error: "Beatmap not found",
            });

            const file = await fetch(
                `${base}/getbeatmapfile?id=75&key=${bulkKey}`,
            );

            expect(await file.text()).toBe(state.files.get(75)?.toString());
            expect(await readFile(join(directory, "75.osu"))).toEqual(
                state.files.get(75),
            );

            state.rateLimited = true;

            const limited = await fetch(
                `${base}/getbeatmap?id=77&key=${bulkKey}`,
            );

            expect(limited.status).toBe(503);
            expect(limited.headers.get("retry-after")).toBe("30");

            server.child.kill("SIGTERM");

            expect(await server.exited).toBe(0);
            expect(server.output()).toContain("[beatmap-service]");
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("refuses to start on a pre-rewrite database that was never baselined", async () => {
        await using postgres = await startTestPostgres();
        await using osu = await startStubOsu();
        const directory = await mkdtemp(join(tmpdir(), "e2e-beatmaps-"));
        const client = new pg.Client({
            host: "127.0.0.1",
            port: postgres.port,
            user: "postgres",
            database: "postgres",
        });

        await client.connect();
        await client.query(
            await readFile(
                fileURLToPath(
                    new URL(
                        "../fixtures/production-schema.sql",
                        import.meta.url,
                    ),
                ),
                "utf8",
            ),
        );
        await client.end();

        try {
            const { port, env } = await buildEnvironment(
                postgres.port,
                osu.url,
                directory,
            );

            await expect(
                startProcess({
                    script,
                    env,
                    readyUrl: `http://127.0.0.1:${port.toString()}/api/beatmap/health`,
                }),
            ).rejects.toThrow(/pnpm db:baseline/);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
