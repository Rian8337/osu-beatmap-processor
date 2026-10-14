import { DatabaseUnavailableError } from "@/database/errors";
import { BeatmapService } from "@/services/BeatmapService";
import { BeatmapsetService } from "@/services/BeatmapsetService";
import { buildApiBeatmap } from "@test/fixtures/osu/beatmaps";
import { testConfig } from "@test/utils/config";
import { FakeBeatmapRepository } from "@test/fakes/FakeBeatmapRepository";
import { FakeBeatmapsetRepository } from "@test/fakes/FakeBeatmapsetRepository";
import { FakeBeatmapFileStore } from "@test/fakes/FakeBeatmapFileStore";
import { FakeOsuGateway } from "@test/fakes/FakeOsuGateway";
import { silenceConsoleErrors } from "@test/utils/silenceConsoleErrors";
import { buildBeatmapRow } from "@test/utils/rows";
import { OsuUnavailableError } from "@/osu/errors";
import { afterEach, describe, expect, it, vi } from "vitest";

const twoDaysAgo = () => new Date(Date.now() - 2 * 86_400_000);

function setup(beatmapRepository = new FakeBeatmapRepository()) {
    const osuGateway = new FakeOsuGateway();
    const beatmapsetRepository = new FakeBeatmapsetRepository(
        beatmapRepository,
    );
    const beatmapFileStore = new FakeBeatmapFileStore();
    const beatmapService = new BeatmapService(
        testConfig,
        beatmapRepository,
        beatmapsetRepository,
        beatmapFileStore,
        osuGateway,
    );
    const createService = () =>
        new BeatmapsetService(
            testConfig,
            beatmapsetRepository,
            beatmapRepository,
            beatmapService,
            beatmapFileStore,
            osuGateway,
        );

    return {
        osuGateway,
        beatmapRepository,
        beatmapsetRepository,
        beatmapFileStore,
        beatmapService,
        service: createService(),
        createService,
    };
}

const ids = (rows: readonly { beatmapId: number }[] | null) =>
    rows?.map((r) => r.beatmapId);

describe("BeatmapsetService", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("stores a set from osu! complete and serves it from the database afterwards", async () => {
        const {
            osuGateway,
            beatmapRepository,
            beatmapsetRepository,
            createService,
            service,
        } = setup();

        osuGateway.addBeatmaps(
            buildApiBeatmap({ beatmap_id: "76", file_md5: "1".repeat(32) }),
            buildApiBeatmap(),
            buildApiBeatmap({
                beatmap_id: "1001",
                mode: "1",
                file_md5: "2".repeat(32),
            }),
        );

        expect(ids(await service.getBeatmapset("priority", 1))).toEqual([
            75, 76,
        ]);
        expect(
            [...beatmapRepository.rows.keys()].sort((a, b) => a - b),
        ).toEqual([75, 76]);
        expect(beatmapsetRepository.lastCheckedById.has(1)).toBe(true);

        // A fresh service (empty memory) reads the stored set.
        expect(ids(await createService().getBeatmapset("bulk", 1))).toEqual([
            75, 76,
        ]);
        expect(osuGateway.calls).toEqual(["getBeatmapset priority 1"]);
    });

    it("serves repeated requests from memory", async () => {
        const { osuGateway, beatmapRepository, service } = setup();

        osuGateway.addBeatmaps(buildApiBeatmap());
        await service.getBeatmapset("priority", 1);

        const reads = beatmapRepository.readCount;

        await service.getBeatmapset("priority", 1);

        expect(beatmapRepository.readCount).toBe(reads);
        expect(osuGateway.calls).toHaveLength(1);
    });

    it("lets single lookups use the beatmaps of a fetched set", async () => {
        const { osuGateway, beatmapService, service } = setup();

        osuGateway.addBeatmaps(
            buildApiBeatmap(),
            buildApiBeatmap({ beatmap_id: "76", file_md5: "1".repeat(32) }),
        );
        await service.getBeatmapset("priority", 1);

        expect(
            await beatmapService.getBeatmap("priority", { id: 76 }),
        ).toMatchObject({
            beatmapId: 76,
        });
        expect(osuGateway.calls).toEqual(["getBeatmapset priority 1"]);
    });

    it("does not treat a partly stored set as complete", async () => {
        const { osuGateway, service } = setup(
            new FakeBeatmapRepository(buildBeatmapRow()),
        );

        osuGateway.addBeatmaps(
            buildApiBeatmap(),
            buildApiBeatmap({ beatmap_id: "76", file_md5: "1".repeat(32) }),
        );

        expect(ids(await service.getBeatmapset("priority", 1))).toEqual([
            75, 76,
        ]);
        expect(osuGateway.calls).toEqual(["getBeatmapset priority 1"]);
    });

    it("answers null for a set osu! does not have", async () => {
        const { service } = setup();

        expect(await service.getBeatmapset("priority", 999)).toBeNull();
    });

    it("answers an empty list for a set without osu!standard beatmaps", async () => {
        const { osuGateway, beatmapsetRepository, service } = setup();

        osuGateway.addBeatmaps(
            buildApiBeatmap({ beatmap_id: "1001", mode: "1" }),
        );

        expect(await service.getBeatmapset("priority", 1)).toEqual([]);
        expect(beatmapsetRepository.lastCheckedById.has(1)).toBe(true);
    });

    it("re-checks a due set, dropping beatmaps osu! no longer lists and their files", async () => {
        const beatmapRepository = new FakeBeatmapRepository(
            buildBeatmapRow({ approved: "-2" }, twoDaysAgo()),
            buildBeatmapRow(
                { beatmap_id: "76", approved: "-2", file_md5: "1".repeat(32) },
                twoDaysAgo(),
            ),
        );
        const { osuGateway, beatmapsetRepository, beatmapFileStore, service } =
            setup(beatmapRepository);

        beatmapsetRepository.lastCheckedById.set(1, twoDaysAgo());
        beatmapFileStore.files.set(75, Buffer.from("kept"));
        beatmapFileStore.files.set(76, Buffer.from("removed"));
        osuGateway.addBeatmaps(buildApiBeatmap({ approved: "-2" }));

        expect(ids(await service.getBeatmapset("priority", 1))).toEqual([75]);
        expect(osuGateway.calls).toEqual(["tryGetBeatmapsetNow priority 1"]);
        expect(beatmapRepository.rows.has(76)).toBe(false);
        expect(beatmapFileStore.files.has(76)).toBe(false);
        expect(beatmapFileStore.files.has(75)).toBe(true);
    });

    it("deletes the file of a beatmap whose hash changed", async () => {
        const beatmapRepository = new FakeBeatmapRepository(
            buildBeatmapRow(
                { approved: "-2", file_md5: "a".repeat(32) },
                twoDaysAgo(),
            ),
        );
        const { osuGateway, beatmapsetRepository, beatmapFileStore, service } =
            setup(beatmapRepository);

        beatmapsetRepository.lastCheckedById.set(1, twoDaysAgo());
        beatmapFileStore.files.set(75, Buffer.from("old"));
        osuGateway.addBeatmaps(
            buildApiBeatmap({ approved: "-2", file_md5: "b".repeat(32) }),
        );

        await service.getBeatmapset("priority", 1);

        expect(beatmapRepository.rows.get(75)?.fileMd5).toBe("b".repeat(32));
        expect(beatmapFileStore.files.has(75)).toBe(false);
    });

    it("serves the stored set when the re-check is skipped or fails", async () => {
        const beatmapRepository = new FakeBeatmapRepository(
            buildBeatmapRow({ approved: "-2" }, twoDaysAgo()),
        );
        const { osuGateway, beatmapsetRepository, service } =
            setup(beatmapRepository);

        beatmapsetRepository.lastCheckedById.set(1, twoDaysAgo());
        osuGateway.isBusy = true;

        expect(ids(await service.getBeatmapset("priority", 1))).toEqual([75]);

        osuGateway.isBusy = false;
        osuGateway.unavailableForSeconds = 5;

        expect(ids(await service.getBeatmapset("priority", 1))).toEqual([75]);
    });

    it("never re-checks an all-ranked set", async () => {
        const beatmapRepository = new FakeBeatmapRepository(
            buildBeatmapRow({}, new Date(0)),
        );
        const { osuGateway, beatmapsetRepository, service } =
            setup(beatmapRepository);

        beatmapsetRepository.lastCheckedById.set(1, new Date(0));

        expect(ids(await service.getBeatmapset("priority", 1))).toEqual([75]);
        expect(osuGateway.calls).toEqual([]);
    });

    it("deletes a set osu! no longer has", async () => {
        const beatmapRepository = new FakeBeatmapRepository(
            buildBeatmapRow({ approved: "-2" }, twoDaysAgo()),
        );
        const { beatmapsetRepository, beatmapFileStore, service } =
            setup(beatmapRepository);

        beatmapsetRepository.lastCheckedById.set(1, twoDaysAgo());
        beatmapFileStore.files.set(75, Buffer.from("old"));

        expect(await service.getBeatmapset("priority", 1)).toBeNull();
        expect(beatmapRepository.rows.size).toBe(0);
        expect(beatmapsetRepository.lastCheckedById.has(1)).toBe(false);
        expect(beatmapFileStore.files.has(75)).toBe(false);
    });

    it("shares one lookup across lanes", async () => {
        const { osuGateway, service } = setup();
        let open = () => {};

        osuGateway.addBeatmaps(buildApiBeatmap());
        osuGateway.gate = new Promise((resolve) => (open = resolve));

        const lookups = [
            service.getBeatmapset("priority", 1),
            service.getBeatmapset("bulk", 1),
        ];

        open();
        await Promise.all(lookups);

        expect(osuGateway.calls).toEqual(["getBeatmapset priority 1"]);
    });

    it("answers DatabaseUnavailableError without asking osu!", async () => {
        const { osuGateway, beatmapRepository, service } = setup();

        osuGateway.addBeatmaps(buildApiBeatmap());
        beatmapRepository.shouldFailReads = true;

        await expect(
            service.getBeatmapset("priority", 1),
        ).rejects.toBeInstanceOf(DatabaseUnavailableError);
        expect(osuGateway.calls).toEqual([]);
    });

    it("still serves a fetched set when storing it fails", async () => {
        const log = silenceConsoleErrors();
        const { osuGateway, beatmapRepository, service } = setup();

        osuGateway.addBeatmaps(buildApiBeatmap());
        beatmapRepository.shouldFailWrites = true;

        expect(ids(await service.getBeatmapset("priority", 1))).toEqual([75]);
        expect(log).toHaveBeenCalled();
    });

    it("throws OsuUnavailableError for an unstored set when osu! is unavailable", async () => {
        const { osuGateway, service } = setup();

        osuGateway.unavailableForSeconds = 5;

        await expect(
            service.getBeatmapset("priority", 1),
        ).rejects.toBeInstanceOf(OsuUnavailableError);
    });

    it("logs a failed re-check and serves the stored set", async () => {
        const log = silenceConsoleErrors();
        const beatmapRepository = new FakeBeatmapRepository(
            buildBeatmapRow({ approved: "-2" }, twoDaysAgo()),
        );
        const { osuGateway, beatmapsetRepository, service } =
            setup(beatmapRepository);

        beatmapsetRepository.lastCheckedById.set(1, twoDaysAgo());
        osuGateway.unavailableForSeconds = 5;

        expect(ids(await service.getBeatmapset("priority", 1))).toEqual([75]);
        expect(log).toHaveBeenCalledWith(
            "Failed to re-check beatmapset 1:",
            expect.any(String),
        );
    });

    it("logs a failed delete of a set osu! no longer has", async () => {
        const log = silenceConsoleErrors();
        const beatmapRepository = new FakeBeatmapRepository(
            buildBeatmapRow({ approved: "-2" }, twoDaysAgo()),
        );
        const { beatmapsetRepository, service } = setup(beatmapRepository);

        beatmapsetRepository.lastCheckedById.set(1, twoDaysAgo());
        beatmapRepository.shouldFailWrites = true;

        expect(await service.getBeatmapset("priority", 1)).toBeNull();
        expect(log).toHaveBeenCalledWith(
            "Failed to delete beatmapset 1:",
            expect.any(String),
        );
    });

    it("expires a memory entry 15 minutes after it was set, however often it is read", async () => {
        vi.useFakeTimers();

        const { osuGateway, beatmapRepository, service } = setup();

        osuGateway.addBeatmaps(buildApiBeatmap({ approved: "1" }));
        await service.getBeatmapset("priority", 1);

        const readsAfterFirst = beatmapRepository.readCount;

        for (let minute = 0; minute < 14; minute++) {
            vi.advanceTimersByTime(60_000);
            await service.getBeatmapset("priority", 1);
        }

        expect(beatmapRepository.readCount).toBe(readsAfterFirst);

        vi.advanceTimersByTime(2 * 60_000);
        await service.getBeatmapset("priority", 1);

        expect(beatmapRepository.readCount).toBeGreaterThan(readsAfterFirst);
    });

    it("expires a set read from the database 15 minutes after it was cached", async () => {
        vi.useFakeTimers();

        const beatmapRepository = new FakeBeatmapRepository(
            buildBeatmapRow({ approved: "1" }),
        );
        const { beatmapsetRepository, service } = setup(beatmapRepository);

        beatmapsetRepository.lastCheckedById.set(1, new Date());
        await service.getBeatmapset("priority", 1);

        const readsAfterFirst = beatmapRepository.readCount;

        for (let minute = 0; minute < 14; minute++) {
            vi.advanceTimersByTime(60_000);
            await service.getBeatmapset("priority", 1);
        }

        expect(beatmapRepository.readCount).toBe(readsAfterFirst);

        vi.advanceTimersByTime(2 * 60_000);
        await service.getBeatmapset("priority", 1);

        expect(beatmapRepository.readCount).toBeGreaterThan(readsAfterFirst);
    });
});
