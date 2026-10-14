import { DatabaseUnavailableError } from "@/database/errors";
import type { BeatmapRow } from "@/database/types";
import { BeatmapRepository } from "@/repositories/BeatmapRepository";
import { BeatmapsetRepository } from "@/repositories/BeatmapsetRepository";
import { createTestDatabase } from "@test/utils/database";
import { buildBeatmapRow } from "@test/utils/rows";
import { describe, expect, it, vi } from "vitest";
import { silenceConsoleErrors } from "@test/utils/silenceConsoleErrors";

vi.setConfig({ testTimeout: 30_000 });

describe("BeatmapsetRepository", () => {
    it("replaces a set in one go and records it complete", async () => {
        await using database = await createTestDatabase();
        const beatmaps = new BeatmapRepository(database.db);
        const beatmapsetRepository = new BeatmapsetRepository(database.db);
        const checkedAt = new Date("2026-10-11T00:00:00Z");

        await beatmaps.upsert([
            buildBeatmapRow({ beatmap_id: "75" }),
            buildBeatmapRow({ beatmap_id: "76" }),
            buildBeatmapRow({ beatmap_id: "80", beatmapset_id: "2" }),
        ]);

        expect(await beatmapsetRepository.findLastChecked(1)).toBeNull();

        const removed = await beatmapsetRepository.replaceBeatmapset(
            1,
            [
                buildBeatmapRow({ beatmap_id: "75", title: "Renamed" }),
                buildBeatmapRow({ beatmap_id: "77" }),
            ],
            checkedAt,
        );

        expect(removed).toEqual([76]);
        expect(
            (await beatmaps.findByBeatmapsetId(1)).map((r) => [
                r.beatmapId,
                r.title,
            ]),
        ).toEqual([
            [75, "Renamed"],
            [77, "DISCO PRINCE"],
        ]);
        expect(await beatmaps.findById(80)).not.toBeNull();
        expect(await beatmapsetRepository.findLastChecked(1)).toEqual(
            checkedAt,
        );
    });

    it("stores an empty set", async () => {
        await using database = await createTestDatabase();
        const beatmapsetRepository = new BeatmapsetRepository(database.db);
        const checkedAt = new Date("2026-10-11T00:00:00Z");

        await new BeatmapRepository(database.db).upsert([buildBeatmapRow()]);

        expect(
            await beatmapsetRepository.replaceBeatmapset(1, [], checkedAt),
        ).toEqual([75]);
        expect(await beatmapsetRepository.findLastChecked(1)).toEqual(
            checkedAt,
        );
    });

    it("forgets completeness and deletes whole sets", async () => {
        await using database = await createTestDatabase();
        const beatmaps = new BeatmapRepository(database.db);
        const beatmapsetRepository = new BeatmapsetRepository(database.db);

        await beatmapsetRepository.replaceBeatmapset(
            1,
            [
                buildBeatmapRow({ beatmap_id: "75" }),
                buildBeatmapRow({ beatmap_id: "76" }),
            ],
            new Date(),
        );
        await beatmapsetRepository.markIncomplete(1);

        expect(await beatmapsetRepository.findLastChecked(1)).toBeNull();
        expect(await beatmaps.findByBeatmapsetId(1)).toHaveLength(2);

        await beatmapsetRepository.replaceBeatmapset(
            1,
            [buildBeatmapRow({ beatmap_id: "75" })],
            new Date(),
        );

        expect(await beatmapsetRepository.deleteBeatmapset(1)).toEqual([75]);
        expect(await beatmaps.findByBeatmapsetId(1)).toEqual([]);
        expect(await beatmapsetRepository.findLastChecked(1)).toBeNull();
    });

    it("leaves the set untouched when replacing it fails partway", async () => {
        await using database = await createTestDatabase();
        const beatmaps = new BeatmapRepository(database.db);
        const beatmapsetRepository = new BeatmapsetRepository(database.db);
        const checkedAt = new Date("2026-10-11T00:00:00Z");

        await beatmapsetRepository.replaceBeatmapset(
            1,
            [
                buildBeatmapRow({ beatmap_id: "75" }),
                buildBeatmapRow({ beatmap_id: "76" }),
            ],
            checkedAt,
        );
        const original = await beatmaps.findByBeatmapsetId(1);
        const invalid = {
            ...buildBeatmapRow({ beatmap_id: "77" }),
            title: null,
        } as unknown as BeatmapRow;

        await expect(
            beatmapsetRepository.replaceBeatmapset(
                1,
                [buildBeatmapRow({ beatmap_id: "75" }), invalid],
                new Date("2026-10-12T00:00:00Z"),
            ),
        ).rejects.toBeInstanceOf(Error);

        expect(await beatmaps.findByBeatmapsetId(1)).toEqual(original);
        expect(await beatmapsetRepository.findLastChecked(1)).toEqual(
            checkedAt,
        );
    });

    it("turns a failed completeness read into DatabaseUnavailableError", async () => {
        const database = await createTestDatabase();
        const beatmapsetRepository = new BeatmapsetRepository(database.db);

        await database[Symbol.asyncDispose]();
        silenceConsoleErrors();

        await expect(
            beatmapsetRepository.findLastChecked(1),
        ).rejects.toBeInstanceOf(DatabaseUnavailableError);
    });
});
