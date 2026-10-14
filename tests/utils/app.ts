import { createApp } from "@/app";
import type { Config } from "@/config/config";
import { dependencyTokens } from "@/dependencies/tokens";
import {
    createFakeOsuHandler,
    type FakeOsuState,
} from "@test/fixtures/osu/fakeOsu";
import { createGoldenOsuState } from "@test/fixtures/osu/beatmaps";
import { testConfig } from "@test/utils/config";
import { createTestContainer } from "@test/utils/container";
import { createTestDatabase, type TestDatabase } from "@test/utils/database";
import { startStubOsu, type StubOsu } from "@test/utils/stubOsu";
import type { Express } from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DependencyContainer } from "tsyringe";

export interface TestApp extends AsyncDisposable {
    readonly app: Express;
    readonly container: DependencyContainer;
    readonly database: TestDatabase;
    readonly osuStub: StubOsu;
    readonly osuState: FakeOsuState;
    readonly beatmapDirectory: string;
}

/**
 * The real app over PGlite, a temporary beatmap directory, and a fake osu! server serving `osuState` (default: the
 * golden state). Keys are loaded.
 */
export async function startTestApp(
    options: { config?: Partial<Config>; osuState?: FakeOsuState } = {},
): Promise<TestApp> {
    const resources = new AsyncDisposableStack();
    const database = await createTestDatabase();

    // Tests may close the database early to simulate an outage; closing it twice must not fail the test.
    resources.defer(() =>
        Promise.resolve(database[Symbol.asyncDispose]()).catch(() => undefined),
    );
    const osuStub = resources.use(await startStubOsu());
    const osuState = options.osuState ?? createGoldenOsuState();
    const beatmapDirectory = await mkdtemp(join(tmpdir(), "beatmaps-"));

    resources.defer(() =>
        rm(beatmapDirectory, { recursive: true, force: true }),
    );
    osuStub.handle(createFakeOsuHandler(osuState));

    const { container } = await createTestContainer({
        db: database.db,
        config: {
            ...testConfig,
            osu: {
                apiKey: "test-osu-key",
                apiBaseUrl: `${osuStub.url}/api`,
                fileBaseUrl: `${osuStub.url}/osu`,
            },
            beatmapFileDirectory: beatmapDirectory,
            ...options.config,
        },
    });

    await container.resolve(dependencyTokens.keyService).load();

    return {
        app: createApp(container),
        container,
        database,
        osuStub,
        osuState,
        beatmapDirectory,
        [Symbol.asyncDispose]: () => resources.disposeAsync(),
    };
}
