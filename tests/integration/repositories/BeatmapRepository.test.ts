import { DatabaseUnavailableError } from "@/database/errors";
import { beatmapTable } from "@/database/schema";
import type { BeatmapRow } from "@/database/types";
import { BeatmapRepository } from "@/repositories/BeatmapRepository";
import { createTestDatabase } from "@test/utils/database";
import { buildBeatmapRow } from "@test/utils/rows";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const hashA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const hashB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/**
 * A row with the same ID whose every other column holds a different value, derived from the schema.
 */
function buildChangedRow(row: BeatmapRow): BeatmapRow {
    const changed: Record<string, unknown> = { ...row };

    for (const [key, column] of Object.entries(getTableColumns(beatmapTable))) {
        if (column.primary) {
            continue;
        }

        const value = changed[key];

        if (key === "fileMd5") {
            changed[key] = "d".repeat(32);
        } else if (column.dataType === "number") {
            changed[key] = typeof value === "number" ? value + 1 : 1;
        } else if (column.dataType === "string") {
            changed[key] = typeof value === "string" ? `${value}x` : "x";
        } else if (column.dataType === "boolean") {
            changed[key] = value !== true;
        } else if (column.dataType === "date") {
            changed[key] = new Date(
                (value instanceof Date ? value.getTime() : 0) + 86_400_000,
            );
        } else {
            throw new Error(`Unhandled column type for ${key}`);
        }
    }

    return changed as BeatmapRow;
}

describe("BeatmapRepository", () => {
    it("stores and finds beatmaps by id, hash, ids, and set", async () => {
        await using database = await createTestDatabase();
        const repository = new BeatmapRepository(database.db);
        const first = buildBeatmapRow({ beatmap_id: "76", file_md5: hashB });
        const second = buildBeatmapRow({ beatmap_id: "75", file_md5: hashA });

        await repository.upsert([first, second]);

        expect(await repository.findById(75)).toEqual(second);
        expect(await repository.findByHash(hashB)).toEqual(first);
        expect(await repository.findById(1)).toBeNull();
        expect(await repository.findByHash("c".repeat(32))).toBeNull();
        expect(
            (await repository.findByIds([75, 76, 77]))
                .map((r) => r.beatmapId)
                .sort((a, b) => a - b),
        ).toEqual([75, 76]);
        expect(await repository.findByIds([])).toEqual([]);
        expect(
            (await repository.findByBeatmapsetId(1)).map((r) => r.beatmapId),
        ).toEqual([75, 76]);
    });

    it("replaces every column on upsert", async () => {
        await using database = await createTestDatabase();
        const repository = new BeatmapRepository(database.db);

        await repository.upsert([
            buildBeatmapRow({ file_md5: hashA, title: "Old" }),
        ]);
        await repository.upsert([
            buildBeatmapRow({ file_md5: hashB, title: "New" }),
        ]);

        expect(await repository.findById(75)).toMatchObject({
            fileMd5: hashB,
            title: "New",
        });
    });

    it("replaces all non-key columns of an existing row", async () => {
        await using database = await createTestDatabase();
        const repository = new BeatmapRepository(database.db);
        const first = buildBeatmapRow();
        const second = buildChangedRow(first);

        await repository.upsert([first]);
        await repository.upsert([second]);

        expect(second).not.toEqual(first);
        expect(await repository.findById(first.beatmapId)).toEqual(second);
    });

    it("updates and deletes", async () => {
        await using database = await createTestDatabase();
        const repository = new BeatmapRepository(database.db);

        await repository.upsert([buildBeatmapRow()]);

        expect(await repository.update(75, { maxCombo: 2 })).toBe(true);
        expect(await repository.update(99, { maxCombo: 2 })).toBe(false);
        expect((await repository.findById(75))?.maxCombo).toBe(2);

        await repository.delete(75);

        expect(await repository.findById(75)).toBeNull();
    });

    it("turns failed reads into DatabaseUnavailableError", async () => {
        const database = await createTestDatabase();
        const repository = new BeatmapRepository(database.db);

        await database[Symbol.asyncDispose]();

        await expect(repository.findById(75)).rejects.toBeInstanceOf(
            DatabaseUnavailableError,
        );
        await expect(repository.findByHash(hashA)).rejects.toBeInstanceOf(
            DatabaseUnavailableError,
        );
        await expect(repository.findByIds([75])).rejects.toBeInstanceOf(
            DatabaseUnavailableError,
        );
        await expect(repository.findByBeatmapsetId(1)).rejects.toBeInstanceOf(
            DatabaseUnavailableError,
        );
    });
});
