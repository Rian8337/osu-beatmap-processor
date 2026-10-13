// Records the responses of the pre-rewrite service (`dist/index.js`, built with `tsc`) into
// tests/golden/responses.json. It was run once, in Task 1 of the rewrite plan, before the old code was removed;
// it cannot run against the rewritten service.
//
// Run with `node scripts/record-golden.ts` (Node strips the types).
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createGoldenOsuState } from "../tests/fixtures/osu/beatmaps.ts";
import { createFakeOsuHandler } from "../tests/fixtures/osu/fakeOsu.ts";
import {
    bulkKey,
    goldenCases,
    priorityKey,
    type GoldenResponse,
} from "../tests/golden/cases.ts";
import { startStubOsu } from "../tests/utils/stubOsu.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

function findFreePort(): Promise<number> {
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

const recordedHeaders = ["content-type", "content-disposition", "retry-after"];

async function main(): Promise<void> {
    const work = await mkdtemp(join(tmpdir(), "golden-"));
    const beatmapDirectory = join(work, "beatmaps");

    await mkdir(beatmapDirectory);

    const database = new PGlite();

    await database.exec(
        await readFile(join(root, "tests/fixtures/production-schema.sql"), "utf8"),
    );

    const postgresPort = await findFreePort();
    const postgres = new PGLiteSocketServer({
        db: database,
        host: "127.0.0.1",
        port: postgresPort,
        maxConnections: 10,
    });

    await postgres.start();

    const state = createGoldenOsuState();
    const osu = await startStubOsu();

    osu.handle(createFakeOsuHandler(state));

    const port = await findFreePort();
    // The cwd is the temporary directory, so the old service's `dotenv` finds no `.env`.
    const child = spawn("node", [join(root, "dist/index.js")], {
        cwd: work,
        env: {
            PATH: process.env.PATH,
            EXPRESS_PORT: port.toString(),
            POSTGRES_HOSTNAME: "127.0.0.1",
            POSTGRES_PORT: postgresPort.toString(),
            POSTGRES_DB_NAME: "postgres",
            POSTGRES_USERNAME: "postgres",
            POSTGRES_PASSWORD: "postgres",
            OSU_API_KEY: "golden-osu-key",
            INTERNAL_SERVER_KEY: priorityKey,
            BULK_SERVER_KEY: bulkKey,
            OSU_API_BASE_URL: `${osu.url}/api`,
            OSU_FILE_BASE_URL: `${osu.url}/osu`,
            BEATMAP_FILE_DIRECTORY: beatmapDirectory,
        },
        stdio: "inherit",
    });

    try {
        const base = `http://127.0.0.1:${port.toString()}`;
        const deadline = Date.now() + 20_000;

        while (!(await fetch(`${base}/api/beatmap/getbeatmap`).then(() => true, () => false))) {
            if (Date.now() > deadline || child.exitCode !== null) {
                throw new Error("The old service did not start");
            }

            await sleep(200);
        }

        const responses: GoldenResponse[] = [];

        for (const golden of goldenCases) {
            state.rateLimited = golden.rateLimited ?? false;

            const response = await fetch(`${base}${golden.path}`);
            const headers: Record<string, string> = {};

            for (const name of recordedHeaders) {
                const value = response.headers.get(name);

                if (value !== null) {
                    headers[name] = value;
                }
            }

            const text = await response.text();
            const body: unknown = headers["content-type"]?.startsWith(
                "application/json",
            )
                ? JSON.parse(text)
                : text;

            responses.push({ name: golden.name, status: response.status, headers, body });
            console.log(`${response.status.toString()} ${golden.name}`);
        }

        await writeFile(
            join(root, "tests/golden/responses.json"),
            `${JSON.stringify(responses, null, 4)}\n`,
        );
    } finally {
        child.kill();
        await osu[Symbol.asyncDispose]();
        await postgres.stop();
        await database.close();
        await rm(work, { recursive: true, force: true });
    }
}

await main();
