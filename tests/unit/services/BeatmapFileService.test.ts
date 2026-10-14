import { OsuUnavailableError } from "@/osu/errors";
import { BeatmapFileService } from "@/services/BeatmapFileService";
import { FakeBeatmapFileStore } from "@test/fakes/FakeBeatmapFileStore";
import { FakeOsuGateway } from "@test/fakes/FakeOsuGateway";
import { buildOsuFile, computeFixtureMD5 } from "@test/fixtures/osu/beatmaps";
import { buildBeatmapRow } from "@test/utils/rows";
import { silenceConsoleErrors } from "@test/utils/silenceConsoleErrors";
import { describe, expect, it, vi } from "vitest";

const file = buildOsuFile(75, "Normal");
const beatmap = buildBeatmapRow({
    file_md5: computeFixtureMD5(file),
    max_combo: "314",
});

function setup() {
    const osuGateway = new FakeOsuGateway();
    const beatmapFileStore = new FakeBeatmapFileStore();
    const beatmapService = {
        refreshBeatmap: vi.fn().mockResolvedValue(null),
        setMaxCombo: vi.fn().mockResolvedValue(undefined),
    };
    const service = new BeatmapFileService(
        beatmapFileStore,
        osuGateway,
        beatmapService,
    );

    return { osuGateway, beatmapFileStore, beatmapService, service };
}

describe("BeatmapFileService", () => {
    it("serves a stored file whose MD5 matches without asking osu!", async () => {
        const { osuGateway, beatmapFileStore, service } = setup();

        beatmapFileStore.files.set(75, file);

        expect(await service.getBeatmapFile("priority", beatmap)).toEqual(file);
        expect(osuGateway.calls).toEqual([]);
    });

    it("downloads a missing file, checks it, and stores it", async () => {
        const { osuGateway, beatmapFileStore, service } = setup();

        osuGateway.files.set(75, file);

        expect(await service.getBeatmapFile("bulk", beatmap)).toEqual(file);
        expect(beatmapFileStore.files.get(75)).toEqual(file);
        expect(osuGateway.calls).toEqual(["downloadFile bulk 75"]);
    });

    it("replaces a stored file whose MD5 does not match", async () => {
        const { osuGateway, beatmapFileStore, service } = setup();

        beatmapFileStore.files.set(75, file.subarray(0, 20));
        osuGateway.files.set(75, file);

        expect(await service.getBeatmapFile("priority", beatmap)).toEqual(file);
        expect(beatmapFileStore.files.get(75)).toEqual(file);
    });

    it("deletes a stale stored file even when osu! has no file", async () => {
        const { beatmapFileStore, service } = setup();

        beatmapFileStore.files.set(75, file.subarray(0, 20));

        expect(await service.getBeatmapFile("priority", beatmap)).toBeNull();
        expect(beatmapFileStore.files.has(75)).toBe(false);
    });

    it("downloads and logs when the stale file cannot be deleted", async () => {
        const log = silenceConsoleErrors();
        const { osuGateway, beatmapFileStore, service } = setup();

        beatmapFileStore.files.set(75, file.subarray(0, 20));
        beatmapFileStore.shouldFailDeletes = true;
        osuGateway.files.set(75, file);

        expect(await service.getBeatmapFile("priority", beatmap)).toEqual(file);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0]?.[0]).toContain("delete");
    });

    it("answers null when osu! has no file", async () => {
        const { service } = setup();

        expect(await service.getBeatmapFile("priority", beatmap)).toBeNull();
    });

    it("lets an unavailable osu! through when downloading", async () => {
        const { osuGateway, service } = setup();

        osuGateway.unavailableForSeconds = 7;

        await expect(
            service.getBeatmapFile("priority", beatmap),
        ).rejects.toBeInstanceOf(OsuUnavailableError);
    });

    it("serves the file when storing it fails", async () => {
        const log = silenceConsoleErrors();
        const { osuGateway, beatmapFileStore, service } = setup();

        osuGateway.files.set(75, file);
        beatmapFileStore.shouldFailWrites = true;

        expect(await service.getBeatmapFile("priority", beatmap)).toEqual(file);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0]?.[0]).toContain("store");
    });

    it("downloads when the stored file cannot be read", async () => {
        const log = silenceConsoleErrors();
        const { osuGateway, beatmapFileStore, service } = setup();

        osuGateway.files.set(75, file);
        beatmapFileStore.shouldFailReads = true;

        expect(await service.getBeatmapFile("priority", beatmap)).toEqual(file);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0]?.[0]).toContain("read");
    });

    it("shares one download across lanes", async () => {
        const { osuGateway, service } = setup();
        let open = () => {};

        osuGateway.files.set(75, file);
        osuGateway.gate = new Promise((resolve) => (open = resolve));

        const downloads = [
            service.getBeatmapFile("priority", beatmap),
            service.getBeatmapFile("bulk", beatmap),
        ];

        open();
        await Promise.all(downloads);

        expect(osuGateway.calls).toEqual(["downloadFile priority 75"]);
    });

    it("does not share a download between versions of a beatmap", async () => {
        silenceConsoleErrors();
        const { osuGateway, beatmapService, service } = setup();
        const outdated = buildBeatmapRow({ file_md5: "f".repeat(32) });
        let open = () => {};

        osuGateway.files.set(75, file);
        osuGateway.gate = new Promise((resolve) => (open = resolve));
        beatmapService.refreshBeatmap.mockResolvedValue(outdated);

        const matching = service.getBeatmapFile("priority", beatmap);
        const mismatching = service.getBeatmapFile("priority", outdated);
        open();

        const [matched, mismatched] = await Promise.allSettled([
            matching,
            mismatching,
        ]);

        expect(matched).toEqual({ status: "fulfilled", value: file });
        expect(mismatched.status).toBe("rejected");
        expect(
            mismatched.status === "rejected" && mismatched.reason,
        ).toBeInstanceOf(OsuUnavailableError);
        expect(osuGateway.calls).toHaveLength(2);
    });

    it("refreshes the metadata once when the download matches a newer version", async () => {
        const { osuGateway, beatmapFileStore, beatmapService, service } =
            setup();
        const newer = buildOsuFile(75, "Normal v2");

        osuGateway.files.set(75, newer);
        beatmapService.refreshBeatmap.mockResolvedValue(
            buildBeatmapRow({ file_md5: computeFixtureMD5(newer) }),
        );

        expect(await service.getBeatmapFile("priority", beatmap)).toEqual(
            newer,
        );
        expect(beatmapService.refreshBeatmap).toHaveBeenCalledTimes(1);
        expect(beatmapService.refreshBeatmap).toHaveBeenCalledWith(
            "priority",
            75,
        );
        expect(beatmapFileStore.files.get(75)).toEqual(newer);
    });

    it("does not refresh the metadata when the download matches", async () => {
        const { osuGateway, beatmapService, service } = setup();

        osuGateway.files.set(75, file);

        await service.getBeatmapFile("priority", beatmap);

        expect(beatmapService.refreshBeatmap).not.toHaveBeenCalled();
    });

    it("answers unavailable when the download matches no metadata", async () => {
        const log = silenceConsoleErrors();
        const { osuGateway, beatmapFileStore, beatmapService, service } =
            setup();

        osuGateway.files.set(75, buildOsuFile(75, "Something else"));
        beatmapService.refreshBeatmap.mockResolvedValue(beatmap);

        await expect(
            service.getBeatmapFile("priority", beatmap),
        ).rejects.toBeInstanceOf(OsuUnavailableError);
        expect(beatmapFileStore.files.has(75)).toBe(false);
        expect(log).toHaveBeenCalledTimes(1);
    });

    it("answers unavailable when the beatmap is gone from osu! after a mismatch", async () => {
        silenceConsoleErrors();
        const { osuGateway, beatmapFileStore, service } = setup();

        osuGateway.files.set(75, buildOsuFile(75, "Something else"));

        await expect(
            service.getBeatmapFile("priority", beatmap),
        ).rejects.toBeInstanceOf(OsuUnavailableError);
        expect(beatmapFileStore.files.has(75)).toBe(false);
    });

    it("lets an unavailable osu! through when refreshing the metadata", async () => {
        const { osuGateway, beatmapService, service } = setup();
        const unavailable = new OsuUnavailableError(9);

        osuGateway.files.set(75, buildOsuFile(75, "Something else"));
        beatmapService.refreshBeatmap.mockRejectedValue(unavailable);

        await expect(service.getBeatmapFile("priority", beatmap)).rejects.toBe(
            unavailable,
        );
    });

    it("backfills a missing max combo from the file", async () => {
        const { beatmapService, service } = setup();

        service.backfillMaxCombo({ ...beatmap, maxCombo: null }, file);

        await vi.waitFor(() =>
            expect(beatmapService.setMaxCombo).toHaveBeenCalledWith(75, 2),
        );
    });

    it("leaves a known max combo alone", async () => {
        const { beatmapService, service } = setup();

        service.backfillMaxCombo(beatmap, file);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(beatmapService.setMaxCombo).not.toHaveBeenCalled();
    });

    it("logs when the max combo cannot be stored", async () => {
        const log = silenceConsoleErrors();
        const { beatmapService, service } = setup();

        beatmapService.setMaxCombo.mockRejectedValue(new Error("boom"));
        service.backfillMaxCombo({ ...beatmap, maxCombo: null }, file);

        await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
        expect(log.mock.calls[0]?.[0]).toContain("max combo");
    });
});
