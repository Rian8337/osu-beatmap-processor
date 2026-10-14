import { runCli } from "@/cli/run";
import { BeatmapRepository } from "@/repositories/BeatmapRepository";
import { FakeOsuGateway } from "@test/fakes/FakeOsuGateway";
import { buildApiBeatmap } from "@test/fixtures/osu/beatmaps";
import { createCliDependencies } from "@test/utils/cli";
import { createTestDatabase } from "@test/utils/database";
import { buildBeatmapRow } from "@test/utils/rows";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const plus8 = (date: Date) => new Date(date.getTime() + 8 * 3_600_000);
const correctSubmitDate = new Date("2007-10-06T17:46:31Z");

/**
 * What the pre-rewrite service stored: the correct row with its dates in UTC+8.
 */
function buildShiftedRow(id: string, approved: string) {
    const correct = buildBeatmapRow({ beatmap_id: id, approved });

    return {
        ...correct,
        submitDate: plus8(correct.submitDate),
        approvedDate: plus8(correct.approvedDate!),
        lastUpdate: plus8(correct.lastUpdate),
    };
}

describe("fix-dates", () => {
    it("corrects the dates of stored ranked, approved, and loved beatmaps and inserts nothing", async () => {
        await using database = await createTestDatabase();
        const beatmaps = new BeatmapRepository(database.db);

        await beatmaps.upsert([
            buildShiftedRow("1", "1"),
            buildShiftedRow("2", "4"),
            buildBeatmapRow({ beatmap_id: "3", approved: "2" }),
        ]);

        const osuGateway = new FakeOsuGateway().addBeatmaps(
            buildApiBeatmap({ beatmap_id: "1", approved: "1" }),
            buildApiBeatmap({ beatmap_id: "2", approved: "4" }),
            buildApiBeatmap({ beatmap_id: "3", approved: "2" }),
            buildApiBeatmap({ beatmap_id: "4", approved: "1" }),
        );
        const deps = createCliDependencies(database.db, {
            createOsuGateway: () => osuGateway,
        });

        expect(await runCli(["fix-dates"], deps)).toBe(0);

        for (const id of [1, 2, 3]) {
            expect((await beatmaps.findById(id))?.submitDate).toEqual(
                correctSubmitDate,
            );
        }

        expect(await beatmaps.findById(4)).toBeNull();
        expect(deps.output.lines.at(-1)).toBe(
            "Done: 3 stored beatmaps checked, 2 corrected, 0 skipped (file changed)",
        );
    });

    it("leaves pending and qualified beatmaps to their re-check, and corrects a changed status", async () => {
        await using database = await createTestDatabase();
        const beatmaps = new BeatmapRepository(database.db);
        const pending = buildShiftedRow("1", "0");

        await beatmaps.upsert([
            pending,
            buildShiftedRow("2", "3"),
            buildBeatmapRow({ beatmap_id: "3", approved: "1" }),
        ]);

        const osuGateway = new FakeOsuGateway().addBeatmaps(
            buildApiBeatmap({ beatmap_id: "1", approved: "0" }),
            buildApiBeatmap({ beatmap_id: "2", approved: "3" }),
            buildApiBeatmap({ beatmap_id: "3", approved: "2" }),
        );
        const deps = createCliDependencies(database.db, {
            createOsuGateway: () => osuGateway,
        });

        expect(await runCli(["fix-dates"], deps)).toBe(0);

        expect((await beatmaps.findById(1))?.submitDate).toEqual(
            pending.submitDate,
        );
        expect((await beatmaps.findById(2))?.submitDate).toEqual(
            plus8(correctSubmitDate),
        );
        expect((await beatmaps.findById(3))?.approved).toBe(2);
        expect(deps.output.lines.at(-1)).toBe(
            "Done: 1 stored beatmaps checked, 1 corrected, 0 skipped (file changed)",
        );
    });

    it("corrects nothing on a second pass with --restart", async () => {
        await using database = await createTestDatabase();
        const beatmaps = new BeatmapRepository(database.db);

        await beatmaps.upsert([buildShiftedRow("1", "1")]);

        const osuGateway = new FakeOsuGateway().addBeatmaps(
            buildApiBeatmap({ beatmap_id: "1", approved: "1" }),
        );
        const first = createCliDependencies(database.db, {
            createOsuGateway: () => osuGateway,
        });
        const second = createCliDependencies(database.db, {
            createOsuGateway: () => osuGateway,
        });

        await runCli(["fix-dates"], first);
        await runCli(["fix-dates", "--restart"], second);

        expect(first.output.lines.at(-1)).toBe(
            "Done: 1 stored beatmaps checked, 1 corrected, 0 skipped (file changed)",
        );
        expect(second.output.lines.at(-1)).toBe(
            "Done: 1 stored beatmaps checked, 0 corrected, 0 skipped (file changed)",
        );
    });

    it("counts a beatmap once when overlapping pages deliver it again", async () => {
        await using database = await createTestDatabase();
        const beatmaps = new BeatmapRepository(database.db);
        // A full first page (IDs 1-500) overlaps the second (IDs 499-501) by its last second.
        const osuGateway = new FakeOsuGateway();
        const start = Date.parse("2008-01-01T00:00:00Z");

        for (let id = 1; id <= 501; id++) {
            osuGateway.addBeatmaps(
                buildApiBeatmap({
                    beatmap_id: id.toString(),
                    approved_date: new Date(start + id * 1000)
                        .toISOString()
                        .slice(0, 19)
                        .replace("T", " "),
                }),
            );
        }

        await beatmaps.upsert(
            [499, 500, 501].map((id) => buildShiftedRow(id.toString(), "1")),
        );

        const deps = createCliDependencies(database.db, {
            createOsuGateway: () => osuGateway,
        });

        expect(await runCli(["fix-dates"], deps)).toBe(0);

        expect(osuGateway.calls).toHaveLength(2);
        expect(deps.output.lines.at(-1)).toBe(
            "Done: 3 stored beatmaps checked, 3 corrected, 0 skipped (file changed)",
        );
    });

    it("leaves a stored row untouched, and counts it, when osu! reports a different file hash", async () => {
        await using database = await createTestDatabase();
        const beatmaps = new BeatmapRepository(database.db);
        const pending = buildShiftedRow("1", "0");

        await beatmaps.upsert([
            { ...pending, fileMd5: "a".repeat(32) },
            buildShiftedRow("2", "1"),
        ]);

        const osuGateway = new FakeOsuGateway().addBeatmaps(
            buildApiBeatmap({
                beatmap_id: "1",
                approved: "1",
                file_md5: "b".repeat(32),
            }),
            buildApiBeatmap({ beatmap_id: "2", approved: "1" }),
        );
        const deps = createCliDependencies(database.db, {
            createOsuGateway: () => osuGateway,
        });

        expect(await runCli(["fix-dates"], deps)).toBe(0);

        expect(await beatmaps.findById(1)).toEqual({
            ...pending,
            fileMd5: "a".repeat(32),
        });
        expect((await beatmaps.findById(2))?.submitDate).toEqual(
            correctSubmitDate,
        );
        expect(deps.output.lines.at(-1)).toBe(
            "Done: 2 stored beatmaps checked, 1 corrected, 1 skipped (file changed)",
        );
    });
});
