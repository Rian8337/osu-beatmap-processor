import { runCli } from "@/cli/run";
import { BeatmapRepository } from "@/repositories/BeatmapRepository";
import { CursorRepository } from "@/repositories/CursorRepository";
import {
    buildApiBeatmap,
    buildOsuFile,
    computeFixtureMD5,
} from "@test/fixtures/osu/beatmaps";
import { FakeOsuGateway } from "@test/fakes/FakeOsuGateway";
import { createCliDependencies } from "@test/utils/cli";
import { testConfig } from "@test/utils/config";
import { createTestDatabase } from "@test/utils/database";
import { buildBeatmapRow } from "@test/utils/rows";
import {
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

// Lets a test make `rm` fail, which a root-run test cannot do with permissions.
vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();

    return { ...actual, rm: vi.fn(actual.rm) };
});

describe("populate-cache", () => {
    let dump: string;
    let beatmapDirectory: string;
    const files = {
        ranked: buildOsuFile(1, "Ranked"),
        approved: buildOsuFile(2, "Approved"),
        missing: buildOsuFile(3, "Missing"),
        mismatched: buildOsuFile(4, "Mismatched"),
    };

    function osuGateway() {
        return new FakeOsuGateway().addBeatmaps(
            buildApiBeatmap({
                beatmap_id: "1",
                approved: "1",
                approved_date: "2008-01-01 00:00:00",
                file_md5: computeFixtureMD5(files.ranked),
            }),
            buildApiBeatmap({
                beatmap_id: "2",
                approved: "2",
                approved_date: "2008-01-02 00:00:00",
                file_md5: computeFixtureMD5(files.approved),
            }),
            buildApiBeatmap({
                beatmap_id: "3",
                approved: "1",
                approved_date: "2008-01-03 00:00:00",
                file_md5: computeFixtureMD5(files.missing),
            }),
            buildApiBeatmap({
                beatmap_id: "4",
                approved: "1",
                approved_date: "2008-01-04 00:00:00",
                file_md5: computeFixtureMD5(files.mismatched),
            }),
            buildApiBeatmap({
                beatmap_id: "5",
                approved: "4",
                approved_date: "2008-01-05 00:00:00",
                file_md5: "5".repeat(32),
            }),
            buildApiBeatmap({
                beatmap_id: "6",
                approved: "3",
                approved_date: "2008-01-06 00:00:00",
                file_md5: "6".repeat(32),
            }),
        );
    }

    beforeEach(async () => {
        dump = await mkdtemp(join(tmpdir(), "dump-"));
        beatmapDirectory = await mkdtemp(join(tmpdir(), "beatmaps-"));
        await writeFile(join(dump, "1.osu"), files.ranked);
        await writeFile(join(dump, "2.osu"), files.approved);
        await writeFile(join(dump, "4.osu"), Buffer.from("not the same file"));
    });

    afterEach(async () => {
        await rm(dump, { recursive: true, force: true });
        await rm(beatmapDirectory, { recursive: true, force: true });
    });

    function dependencies(
        db: Parameters<typeof createCliDependencies>[0],
        gateway = osuGateway(),
    ) {
        return createCliDependencies(db, {
            loadConfig: () => ({
                ...testConfig,
                beatmapFileDirectory: beatmapDirectory,
            }),
            createOsuGateway: () => gateway,
        });
    }

    it("stores ranked and approved beatmaps and copies their matching dump files", async () => {
        await using database = await createTestDatabase();
        const deps = dependencies(database.db);

        expect(await runCli(["populate-cache", "--files", dump], deps)).toBe(0);

        const beatmaps = new BeatmapRepository(database.db);

        expect(
            (await beatmaps.findByIds([1, 2, 3, 4, 5, 6]))
                .map((r) => r.beatmapId)
                .sort((a, b) => a - b),
        ).toEqual([1, 2, 3, 4]);
        expect((await readdir(beatmapDirectory)).sort()).toEqual([
            "1.osu",
            "2.osu",
        ]);
        expect(await readFile(join(beatmapDirectory, "1.osu"))).toEqual(
            files.ranked,
        );
        // Copying leaves the dump as it was.
        expect((await readdir(dump)).sort()).toEqual([
            "1.osu",
            "2.osu",
            "4.osu",
        ]);
        expect(deps.output.lines).toContain(
            "Up to 2008-01-06 00:00:00: 4 beatmaps stored, 2 files copied, 1 missing, 1 mismatched",
        );
        expect(deps.output.lines.at(-1)).toBe(
            "Done: 4 beatmaps stored, 2 files copied, 1 missing, 1 mismatched",
        );
    });

    it("moves files with --move", async () => {
        await using database = await createTestDatabase();

        await runCli(
            ["populate-cache", "--files", dump, "--move"],
            dependencies(database.db),
        );

        expect(await readdir(dump)).toEqual(["4.osu"]);
        expect((await readdir(beatmapDirectory)).sort()).toEqual([
            "1.osu",
            "2.osu",
        ]);
    });

    it("stores metadata only without --files, and resumes from its cursor", async () => {
        await using database = await createTestDatabase();
        const gateway = osuGateway();

        await runCli(["populate-cache"], dependencies(database.db, gateway));

        expect(await readdir(beatmapDirectory)).toEqual([]);
        expect(
            await new CursorRepository(database.db).getCursor("populate-cache"),
        ).toEqual(new Date("2008-01-05T23:59:59Z"));

        await runCli(["populate-cache"], dependencies(database.db, gateway));

        expect(gateway.calls.at(-1)).toBe(
            "getBeatmapsSince bulk 2008-01-05 23:59:59",
        );
    });

    it("starts over with --restart", async () => {
        await using database = await createTestDatabase();
        const gateway = osuGateway();

        await runCli(["populate-cache"], dependencies(database.db, gateway));
        await runCli(
            ["populate-cache", "--restart"],
            dependencies(database.db, gateway),
        );

        expect(gateway.calls.at(-1)).toBe(
            "getBeatmapsSince bulk 2007-01-01 00:00:00",
        );
    });

    it("counts a beatmap once when overlapping pages deliver it again, even after moving its file", async () => {
        await using database = await createTestDatabase();
        // A full first page (IDs 1-500) overlaps the second (IDs 499-501) by its last second.
        const gateway = new FakeOsuGateway();
        const start = Date.parse("2008-01-01T00:00:00Z");
        const everyFile = new Map<number, Buffer>();

        for (let id = 1; id <= 501; id++) {
            const file = buildOsuFile(id, "Overlap");
            const approvedDate = new Date(start + id * 1000)
                .toISOString()
                .slice(0, 19)
                .replace("T", " ");

            everyFile.set(id, file);
            gateway.addBeatmaps(
                buildApiBeatmap({
                    beatmap_id: id.toString(),
                    approved_date: approvedDate,
                    file_md5: computeFixtureMD5(file),
                }),
            );
        }

        // The dump's files 1, 2, and 4 (from beforeEach) have other contents than these beatmaps' hashes, so they are
        // mismatched; files 499-501 match.
        for (const id of [499, 500, 501]) {
            await writeFile(
                join(dump, `${id.toString()}.osu`),
                everyFile.get(id)!,
            );
        }

        const deps = dependencies(database.db, gateway);

        expect(
            await runCli(["populate-cache", "--files", dump, "--move"], deps),
        ).toBe(0);

        expect(gateway.calls).toHaveLength(2);
        expect(deps.output.lines.at(-1)).toBe(
            "Done: 501 beatmaps stored, 3 files copied, 495 missing, 3 mismatched",
        );
    });

    it("keeps going when one dump file cannot be read", async () => {
        await using database = await createTestDatabase();
        const deps = dependencies(database.db);

        // A directory where beatmap 2's file should be: reading it fails with EISDIR.
        await rm(join(dump, "2.osu"));
        await mkdir(join(dump, "2.osu"));

        expect(await runCli(["populate-cache", "--files", dump], deps)).toBe(0);

        expect(await readdir(beatmapDirectory)).toEqual(["1.osu"]);
        expect(deps.output.errors).toEqual([
            expect.stringMatching(
                /^Failed to read the file of beatmap 2 from the dump: EISDIR/,
            ),
        ]);
        expect(deps.output.lines.at(-1)).toBe(
            "Done: 4 beatmaps stored, 1 files copied, 1 missing, 1 mismatched, 1 failed",
        );
    });

    it("copies the file and warns when --move cannot remove it from the dump", async () => {
        await using database = await createTestDatabase();
        const deps = dependencies(database.db);

        vi.mocked(rm).mockImplementation((path, options) =>
            String(path).endsWith(".osu")
                ? Promise.reject(new Error("EACCES: permission denied"))
                : vi
                      .importActual<typeof import("node:fs/promises")>(
                          "node:fs/promises",
                      )
                      .then((actual) => actual.rm(path, options)),
        );

        expect(
            await runCli(["populate-cache", "--files", dump, "--move"], deps),
        ).toBe(0);

        expect((await readdir(beatmapDirectory)).sort()).toEqual([
            "1.osu",
            "2.osu",
        ]);
        expect(deps.output.errors).toEqual([
            "Copied beatmap 1 but could not remove it from the dump: EACCES: permission denied",
            "Copied beatmap 2 but could not remove it from the dump: EACCES: permission denied",
        ]);
        expect(deps.output.lines.at(-1)).toBe(
            "Done: 4 beatmaps stored, 2 files copied, 1 missing, 1 mismatched",
        );
    });

    it("stops without moving the cursor when the beatmap files cannot be written", async () => {
        await using database = await createTestDatabase();
        // The store's directory is a regular file, so every write fails.
        const notADirectory = join(beatmapDirectory, "not-a-directory");

        await writeFile(notADirectory, "");

        const deps = createCliDependencies(database.db, {
            loadConfig: () => ({
                ...testConfig,
                beatmapFileDirectory: notADirectory,
            }),
            createOsuGateway: () => osuGateway(),
        });

        expect(
            await runCli(["populate-cache", "--files", dump, "--move"], deps),
        ).toBe(1);

        expect(deps.output.errors).toEqual([
            expect.stringMatching(/^The command failed: Error: EEXIST/),
        ]);
        expect(
            await new CursorRepository(database.db).getCursor("populate-cache"),
        ).toBeNull();
        // Nothing was removed from the dump.
        expect((await readdir(dump)).sort()).toEqual([
            "1.osu",
            "2.osu",
            "4.osu",
        ]);
    });

    describe("when osu! sends no max combo", () => {
        async function runWithStoredBeatmap(
            storedMd5: string,
            osuMaxCombo: string | null,
        ) {
            await using database = await createTestDatabase();
            const beatmaps = new BeatmapRepository(database.db);
            const stored = buildBeatmapRow({
                beatmap_id: "1",
                file_md5: storedMd5,
                max_combo: "500",
            });

            await beatmaps.upsert([stored]);

            const gateway = new FakeOsuGateway().addBeatmaps(
                buildApiBeatmap({
                    beatmap_id: "1",
                    file_md5: "a".repeat(32),
                    max_combo: osuMaxCombo,
                }),
            );

            expect(
                await runCli(
                    ["populate-cache"],
                    dependencies(database.db, gateway),
                ),
            ).toBe(0);

            return (await beatmaps.findById(1))?.maxCombo;
        }

        it("keeps a backfilled max combo of the same file", async () => {
            expect(await runWithStoredBeatmap("a".repeat(32), null)).toBe(500);
        });

        it("drops it when the file changed", async () => {
            expect(await runWithStoredBeatmap("b".repeat(32), null)).toBeNull();
        });

        it("takes osu!'s own max combo when it sends one", async () => {
            expect(await runWithStoredBeatmap("a".repeat(32), "300")).toBe(300);
        });
    });

    it.each([
        [["populate-cache", "--move"], "--move needs --files <dump directory>"],
        [
            ["populate-cache", "--files", "/nonexistent/dump"],
            "/nonexistent/dump is not a directory",
        ],
    ])("rejects %j", async (argv, message) => {
        await using database = await createTestDatabase();
        const deps = dependencies(database.db);

        expect(await runCli(argv, deps)).toBe(1);
        expect(deps.output.errors).toContain(message);
    });

    it.each([
        ["the same path", () => dump],
        ["a path that resolves to it", () => join(dump, "..", basename(dump))],
    ])(
        "rejects --move when --files is BEATMAP_FILE_DIRECTORY (%s)",
        async (_, locate) => {
            await using database = await createTestDatabase();
            const deps = createCliDependencies(database.db, {
                loadConfig: () => ({
                    ...testConfig,
                    beatmapFileDirectory: dump,
                }),
                createOsuGateway: () => osuGateway(),
            });

            expect(
                await runCli(
                    ["populate-cache", "--files", locate(), "--move"],
                    deps,
                ),
            ).toBe(1);
            expect(deps.output.errors).toEqual([
                "--move cannot be used when --files is BEATMAP_FILE_DIRECTORY: it would delete the cache it fills",
            ]);
            // Nothing was fetched, stored, or removed.
            expect((await readdir(dump)).sort()).toEqual([
                "1.osu",
                "2.osu",
                "4.osu",
            ]);
            expect(
                await new BeatmapRepository(database.db).findById(1),
            ).toBeNull();
        },
    );

    it.each([
        ["a file", (file: string) => file],
        ["below a file", (file: string) => join(file, "sub")],
    ])("rejects a dump that is %s", async (_, locate) => {
        await using database = await createTestDatabase();
        const deps = dependencies(database.db);
        const dumpPath = locate(join(dump, "1.osu"));

        expect(
            await runCli(["populate-cache", "--files", dumpPath], deps),
        ).toBe(1);
        expect(deps.output.errors).toEqual([`${dumpPath} is not a directory`]);
    });

    it("shows a failure to check the dump by name instead of calling it not a directory", async () => {
        await using database = await createTestDatabase();
        const deps = dependencies(database.db);

        expect(
            await runCli(["populate-cache", "--files", "x".repeat(300)], deps),
        ).toBe(1);
        expect(deps.output.errors).toEqual([
            expect.stringMatching(/^The command failed: Error: ENAMETOOLONG/),
        ]);
    });
});
