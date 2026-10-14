import { BeatmapFileStore } from "@/repositories/BeatmapFileStore";
import {
    mkdir,
    mkdtemp,
    readdir,
    rm,
    utimes,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silenceConsoleErrors } from "@test/utils/silenceConsoleErrors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const fiveMinutes = 5 * 60_000;

/**
 * Writes a file with the name of a store's temporary file, last modified `ageMs` ago.
 */
async function writeTemporaryFile(
    directory: string,
    name: string,
    ageMs: number,
): Promise<void> {
    const path = join(directory, name);
    const modified = new Date(Date.now() - ageMs);

    await writeFile(path, "partial");
    await utimes(path, modified, modified);
}

describe("BeatmapFileStore", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "files-"));
    });

    afterEach(() => rm(root, { recursive: true, force: true }));

    it("writes, reads, and deletes files named by beatmap ID", async () => {
        const store = new BeatmapFileStore({ beatmapFileDirectory: root });

        expect(await store.read(75)).toBeNull();

        await store.write(75, Buffer.from("osu"));

        expect(await store.read(75)).toEqual(Buffer.from("osu"));
        expect(await readdir(root)).toEqual(["75.osu"]);

        await store.delete(75);
        await store.delete(75);

        expect(await store.read(75)).toBeNull();
    });

    it("creates the directory on first write", async () => {
        const directory = join(root, "nested", "beatmaps");
        const store = new BeatmapFileStore({ beatmapFileDirectory: directory });

        await store.write(75, Buffer.from("osu"));

        expect(await readdir(directory)).toEqual(["75.osu"]);
    });

    it("creates the directory again when it was removed after an earlier write", async () => {
        const directory = join(root, "beatmaps");
        const store = new BeatmapFileStore({ beatmapFileDirectory: directory });

        await store.write(75, Buffer.from("first"));
        await rm(directory, { recursive: true });
        await store.write(76, Buffer.from("second"));

        expect(await readdir(directory)).toEqual(["76.osu"]);
        expect(await store.read(76)).toEqual(Buffer.from("second"));
    });

    it("leaves a whole file when writes race, and no temporary files", async () => {
        const store = new BeatmapFileStore({ beatmapFileDirectory: root });
        const a = Buffer.alloc(1 << 20, "a");
        const b = Buffer.alloc(1 << 20, "b");

        await Promise.all([store.write(75, a), store.write(75, b)]);

        const stored = await store.read(75);

        expect([a, b]).toContainEqual(stored);
        expect(await readdir(root)).toEqual(["75.osu"]);
    });

    it("rethrows read errors other than a missing file", async () => {
        const store = new BeatmapFileStore({ beatmapFileDirectory: root });

        await mkdir(join(root, "75.osu"));

        await expect(store.read(75)).rejects.toMatchObject({ code: "EISDIR" });
    });

    it("leaves no temporary file when the rename fails", async () => {
        const store = new BeatmapFileStore({ beatmapFileDirectory: root });

        // A non-empty directory at the target makes rename fail.
        await mkdir(join(root, "75.osu"));
        await writeFile(join(root, "75.osu", "keep"), "");

        await expect(store.write(75, Buffer.from("osu"))).rejects.toMatchObject(
            {
                code: "EISDIR",
            },
        );

        expect(
            (await readdir(root)).filter((name) => name.endsWith(".tmp")),
        ).toEqual([]);
    });

    it("leaves no temporary file when writing the data fails partway", async () => {
        const store = new BeatmapFileStore({ beatmapFileDirectory: root });

        // writeFile accepts an async iterable: this one yields some bytes, then fails.
        async function* partialThenFail(): AsyncGenerator<Buffer> {
            yield Buffer.from("partial");
            throw Object.assign(new Error("no space left on device"), {
                code: "ENOSPC",
            });
        }

        await expect(
            store.write(75, partialThenFail() as unknown as Buffer),
        ).rejects.toMatchObject({ code: "ENOSPC" });

        expect(await readdir(root)).toEqual([]);
    });

    describe("removeStaleTemporaryFiles", () => {
        it("removes temporary files older than the given age and keeps newer ones", async () => {
            const store = new BeatmapFileStore({
                beatmapFileDirectory: root,
            });

            await writeTemporaryFile(
                root,
                "75.osu.0123456789ab.tmp",
                3_600_000,
            );
            await writeTemporaryFile(root, "76.osu.cdef01234567.tmp", 1_000);

            expect(await store.removeStaleTemporaryFiles(fiveMinutes)).toBe(1);

            expect(await readdir(root)).toEqual(["76.osu.cdef01234567.tmp"]);
        });

        it("keeps files that are not temporary files of the store, however old", async () => {
            const store = new BeatmapFileStore({
                beatmapFileDirectory: root,
            });
            const names = [
                "75.osu",
                "notes.tmp",
                "75.osu.tmp",
                "75.osu.0123456789ab.tmp.bak",
                "75.osu.0123456789.tmp",
                "75.osu.0123456789AB.tmp",
            ];

            for (const name of names) {
                await writeTemporaryFile(root, name, 3_600_000);
            }

            expect(await store.removeStaleTemporaryFiles(fiveMinutes)).toBe(0);

            expect((await readdir(root)).sort()).toEqual([...names].sort());
        });

        it("does nothing when the directory does not exist", async () => {
            const logged = silenceConsoleErrors();
            const store = new BeatmapFileStore({
                beatmapFileDirectory: join(root, "missing"),
            });

            expect(await store.removeStaleTemporaryFiles(fiveMinutes)).toBe(0);
            expect(logged).not.toHaveBeenCalled();
        });

        it("logs a failure to list the directory and does not throw", async () => {
            const logged = silenceConsoleErrors();
            // A file in place of the directory makes listing fail.
            const path = join(root, "file");

            await writeFile(path, "");

            const store = new BeatmapFileStore({ beatmapFileDirectory: path });

            expect(await store.removeStaleTemporaryFiles(fiveMinutes)).toBe(0);
            expect(logged).toHaveBeenCalledOnce();
            expect(logged.mock.calls[0]?.[1]).toContain("ENOTDIR");
        });

        it("logs a failure to delete one file and still removes the rest", async () => {
            const logged = silenceConsoleErrors();
            const store = new BeatmapFileStore({
                beatmapFileDirectory: root,
            });
            const stuck = "75.osu.0123456789ab.tmp";

            // A non-empty directory with a temporary file's name cannot be deleted as a file.
            await mkdir(join(root, stuck));
            await writeFile(join(root, stuck, "keep"), "");
            await writeTemporaryFile(
                root,
                "76.osu.cdef01234567.tmp",
                3_600_000,
            );
            await writeTemporaryFile(
                root,
                "77.osu.89abcdef0123.tmp",
                3_600_000,
            );

            const old = new Date(Date.now() - 3_600_000);

            await utimes(join(root, stuck), old, old);

            expect(await store.removeStaleTemporaryFiles(fiveMinutes)).toBe(2);

            expect(await readdir(root)).toEqual([stuck]);
            expect(logged).toHaveBeenCalledOnce();
            expect(logged.mock.calls[0]?.[0]).toContain(stuck);
        });
    });
});
