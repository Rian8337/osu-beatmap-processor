import { BeatmapFileStore } from "@/repositories/BeatmapFileStore";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
});
