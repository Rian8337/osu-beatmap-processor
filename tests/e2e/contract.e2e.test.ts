import { createGoldenOsuState } from "@test/fixtures/osu/beatmaps";
import { createFakeOsuHandler } from "@test/fixtures/osu/fakeOsu";
import { bulkKey, goldenCases, priorityKey } from "@test/golden/cases";
import {
    normalizeResponse,
    buildExpectedResponse,
} from "@test/golden/expected";
import { startStubOsu } from "@test/utils/stubOsu";
import { freePort, startProcess, startTestPostgres } from "@/server/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("the built server", () => {
    it("answers the recorded requests", async () => {
        await using postgres = await startTestPostgres();
        await using osu = await startStubOsu();
        const state = createGoldenOsuState();
        const directory = await mkdtemp(join(tmpdir(), "e2e-contract-"));
        const port = await freePort();

        osu.handle(createFakeOsuHandler(state));

        try {
            await using _server = await startProcess({
                script: fileURLToPath(
                    new URL("../../dist/index.mjs", import.meta.url),
                ),
                env: {
                    PATH: process.env.PATH,
                    CI: "1",
                    EXPRESS_PORT: port.toString(),
                    POSTGRES_HOSTNAME: "127.0.0.1",
                    POSTGRES_PORT: postgres.port.toString(),
                    POSTGRES_DB_NAME: "postgres",
                    POSTGRES_USERNAME: "postgres",
                    OSU_API_KEY: "e2e-osu-key",
                    INTERNAL_SERVER_KEY: priorityKey,
                    BULK_SERVER_KEY: bulkKey,
                    OSU_API_BASE_URL: `${osu.url}/api`,
                    OSU_FILE_BASE_URL: `${osu.url}/osu`,
                    BEATMAP_FILE_DIRECTORY: directory,
                },
                readyUrl: `http://127.0.0.1:${port.toString()}/api/beatmap/health`,
            });

            for (const golden of goldenCases) {
                state.rateLimited = golden.rateLimited ?? false;

                const response = await fetch(
                    `http://127.0.0.1:${port.toString()}${golden.path}`,
                );

                expect({
                    name: golden.name,
                    ...normalizeResponse(
                        response.status,
                        (name) => response.headers.get(name) ?? undefined,
                        await response.text(),
                    ),
                }).toEqual({
                    name: golden.name,
                    ...buildExpectedResponse(golden),
                });
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
