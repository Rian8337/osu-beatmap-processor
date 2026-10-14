import { DatabaseUnavailableError } from "@/database/errors";
import { BeatmapService } from "@/services/BeatmapService";
import { buildApiBeatmap } from "@test/fixtures/osu/beatmaps";
import { testConfig } from "@test/utils/config";
import { FakeBeatmapRepository } from "@test/fakes/FakeBeatmapRepository";
import { FakeBeatmapsetRepository } from "@test/fakes/FakeBeatmapsetRepository";
import { FakeBeatmapFileStore } from "@test/fakes/FakeBeatmapFileStore";
import { FakeOsuGateway } from "@test/fakes/FakeOsuGateway";
import { silenceConsoleErrors } from "@test/utils/silenceConsoleErrors";
import { buildBeatmapRow } from "@test/utils/rows";
import { RankedStatus } from "@rian8337/osu-base";
import { describe, expect, it } from "vitest";

const hashA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const hashB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const twoDaysAgo = () => new Date(Date.now() - 2 * 86_400_000);

function setup(...stored: ReturnType<typeof buildBeatmapRow>[]) {
    const osuGateway = new FakeOsuGateway();
    const beatmapRepository = new FakeBeatmapRepository(...stored);
    const beatmapsetRepository = new FakeBeatmapsetRepository(
        beatmapRepository,
    );
    const beatmapFileStore = new FakeBeatmapFileStore();
    const service = new BeatmapService(
        testConfig,
        beatmapRepository,
        beatmapsetRepository,
        beatmapFileStore,
        osuGateway,
    );

    return {
        osuGateway,
        beatmapRepository,
        beatmapsetRepository,
        beatmapFileStore,
        service,
    };
}

describe("BeatmapService", () => {
    it("asks osu! for an unknown beatmap, stores it, then serves it from memory", async () => {
        const { osuGateway, beatmapRepository, service } = setup();

        osuGateway.addBeatmaps(buildApiBeatmap({ file_md5: hashA }));

        const first = await service.getBeatmap("priority", { id: 75 });

        expect(first).toMatchObject({ beatmapId: 75, fileMd5: hashA });
        expect(beatmapRepository.rows.get(75)).toMatchObject({
            fileMd5: hashA,
        });
        expect(Object.isFrozen(first)).toBe(true);

        await service.getBeatmap("bulk", { id: 75 });
        await service.getBeatmap("bulk", { hash: hashA });

        expect(osuGateway.calls).toEqual(["getBeatmap priority 75"]);
        expect(beatmapRepository.readCount).toBe(2);
    });

    it("serves a stored beatmap without asking osu!", async () => {
        const { osuGateway, service } = setup(
            buildBeatmapRow({ file_md5: hashA }),
        );

        expect(
            await service.getBeatmap("priority", { hash: hashA }),
        ).toMatchObject({
            beatmapId: 75,
        });
        expect(osuGateway.calls).toEqual([]);
    });

    it("answers null when osu! has no such beatmap", async () => {
        const { osuGateway, service } = setup();

        osuGateway.addBeatmaps(
            buildApiBeatmap({ beatmap_id: "1001", mode: "1" }),
        );

        expect(await service.getBeatmap("priority", { id: 999 })).toBeNull();
        expect(await service.getBeatmap("priority", { id: 1001 })).toBeNull();
    });

    it("shares one lookup across lanes", async () => {
        const { osuGateway, service } = setup();
        let open = () => {};

        osuGateway.addBeatmaps(buildApiBeatmap());
        osuGateway.gate = new Promise((resolve) => (open = resolve));

        const lookups = [
            service.getBeatmap("priority", { id: 75 }),
            service.getBeatmap("bulk", { id: 75 }),
        ];

        open();

        const [a, b] = await Promise.all(lookups);

        expect(a).toBe(b);
        expect(osuGateway.calls).toEqual(["getBeatmap priority 75"]);
    });

    it("answers DatabaseUnavailableError without asking osu!", async () => {
        const { osuGateway, beatmapRepository, service } = setup();

        osuGateway.addBeatmaps(buildApiBeatmap());
        beatmapRepository.shouldFailReads = true;

        await expect(
            service.getBeatmap("priority", { id: 75 }),
        ).rejects.toBeInstanceOf(DatabaseUnavailableError);
        expect(osuGateway.calls).toEqual([]);
    });

    it("still serves a fetched beatmap when storing it fails", async () => {
        const log = silenceConsoleErrors();
        const { osuGateway, beatmapRepository, service } = setup();

        osuGateway.addBeatmaps(buildApiBeatmap());
        beatmapRepository.shouldFailWrites = true;

        expect(await service.getBeatmap("priority", { id: 75 })).toMatchObject({
            beatmapId: 75,
        });
        expect(log).toHaveBeenCalled();
    });

    it("replaces a stored beatmap that osu! now knows under a new hash", async () => {
        const {
            osuGateway,
            beatmapRepository,
            beatmapsetRepository,
            beatmapFileStore,
            service,
        } = setup(buildBeatmapRow({ file_md5: hashA }));

        beatmapFileStore.files.set(75, Buffer.from("old"));
        beatmapsetRepository.lastCheckedById.set(1, new Date());
        await service.getBeatmap("priority", { hash: hashA });
        osuGateway.addBeatmaps(buildApiBeatmap({ file_md5: hashB }));

        expect(
            await service.getBeatmap("priority", { hash: hashB }),
        ).toMatchObject({
            fileMd5: hashB,
        });
        expect(beatmapRepository.rows.get(75)?.fileMd5).toBe(hashB);
        expect(beatmapFileStore.files.has(75)).toBe(false);
        expect(beatmapsetRepository.lastCheckedById.has(1)).toBe(false);
        // The old hash is no longer served from memory.
        expect(
            await service.getBeatmap("priority", { hash: hashA }),
        ).toBeNull();
    });

    it("never re-checks ranked, approved, or loved beatmaps", async () => {
        const { osuGateway, service } = setup(
            buildBeatmapRow({}, new Date(0)),
            buildBeatmapRow(
                { beatmap_id: "76", approved: "2", file_md5: hashA },
                new Date(0),
            ),
            buildBeatmapRow(
                { beatmap_id: "77", approved: "4", file_md5: hashB },
                new Date(0),
            ),
        );

        await service.getBeatmap("priority", { id: 75 });
        await service.getBeatmap("priority", { id: 76 });
        await service.getBeatmap("priority", { id: 77 });

        expect(osuGateway.calls).toEqual([]);
    });

    it("re-checks a due beatmap when idle and rewrites its dates", async () => {
        const stale = {
            ...buildBeatmapRow(
                { approved: "-2", max_combo: "314" },
                twoDaysAgo(),
            ),
            // A pre-rewrite row with UTC+8 dates.
            submitDate: new Date("2007-10-07T01:46:31Z"),
        };
        const { osuGateway, beatmapRepository, service } = setup(stale);

        osuGateway.addBeatmaps(
            buildApiBeatmap({
                approved: "-2",
                max_combo: null,
                playcount: "2000",
            }),
        );

        const checked = await service.getBeatmap("priority", { id: 75 });

        expect(osuGateway.calls).toEqual(["tryGetBeatmapNow priority 75"]);
        expect(checked).toMatchObject({
            submitDate: new Date("2007-10-06T17:46:31Z"),
            playcount: 2000,
            // osu! returned no max combo; the stored one is kept.
            maxCombo: 314,
        });
        expect(checked?.lastChecked.getTime()).toBeGreaterThan(
            Date.now() - 60_000,
        );
        expect(beatmapRepository.rows.get(75)).toMatchObject({
            submitDate: new Date("2007-10-06T17:46:31Z"),
            maxCombo: 314,
        });
    });

    it("serves the cached beatmap when the re-check is skipped or fails", async () => {
        const stale = buildBeatmapRow({ approved: "-2" }, twoDaysAgo());
        const { osuGateway, service } = setup(stale);

        osuGateway.addBeatmaps(buildApiBeatmap({ approved: "1" }));
        osuGateway.isBusy = true;

        expect(await service.getBeatmap("priority", { id: 75 })).toEqual(stale);

        osuGateway.isBusy = false;
        osuGateway.unavailableForSeconds = 5;

        expect(await service.getBeatmap("priority", { id: 75 })).toEqual(stale);
    });

    it("forgets a beatmap osu! no longer has", async () => {
        const {
            osuGateway,
            beatmapRepository,
            beatmapsetRepository,
            beatmapFileStore,
            service,
        } = setup(buildBeatmapRow({ approved: "-2" }, twoDaysAgo()));

        beatmapFileStore.files.set(75, Buffer.from("old"));
        beatmapsetRepository.lastCheckedById.set(1, new Date());

        expect(await service.getBeatmap("priority", { id: 75 })).toBeNull();
        expect(osuGateway.calls).toEqual(["tryGetBeatmapNow priority 75"]);
        expect(beatmapRepository.rows.has(75)).toBe(false);
        expect(beatmapFileStore.files.has(75)).toBe(false);
        expect(beatmapsetRepository.lastCheckedById.has(1)).toBe(false);
    });

    it("replaces a beatmap whose re-check finds a new hash", async () => {
        const { osuGateway, beatmapRepository, beatmapFileStore, service } =
            setup(
                buildBeatmapRow(
                    { approved: "-2", file_md5: hashA },
                    twoDaysAgo(),
                ),
            );

        beatmapFileStore.files.set(75, Buffer.from("old"));
        osuGateway.addBeatmaps(
            buildApiBeatmap({ approved: "3", file_md5: hashB }),
        );

        expect(await service.getBeatmap("priority", { id: 75 })).toMatchObject({
            approved: RankedStatus.Qualified,
            fileMd5: hashB,
        });
        expect(beatmapRepository.rows.get(75)?.fileMd5).toBe(hashB);
        expect(beatmapFileStore.files.has(75)).toBe(false);
    });

    it("refreshes a beatmap from osu! on demand", async () => {
        const { osuGateway, beatmapRepository, service } = setup(
            buildBeatmapRow({ file_md5: hashA }),
        );

        osuGateway.addBeatmaps(buildApiBeatmap({ file_md5: hashB }));

        expect(await service.refreshBeatmap("bulk", 75)).toMatchObject({
            fileMd5: hashB,
        });
        expect(osuGateway.calls).toEqual(["getBeatmap bulk 75"]);
        expect(beatmapRepository.rows.get(75)?.fileMd5).toBe(hashB);
    });

    it("stores a computed max combo in memory and the database", async () => {
        const { beatmapRepository, service } = setup(
            buildBeatmapRow({ max_combo: null }),
        );

        await service.getBeatmap("priority", { id: 75 });
        await service.setMaxCombo(75, 2);

        expect(beatmapRepository.rows.get(75)?.maxCombo).toBe(2);

        beatmapRepository.shouldFailReads = true;

        expect(
            (await service.getBeatmap("priority", { id: 75 }))?.maxCombo,
        ).toBe(2);
    });
});
