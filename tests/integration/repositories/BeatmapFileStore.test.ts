import { BeatmapFileStore } from "@/repositories/BeatmapFileStore";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

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
});
