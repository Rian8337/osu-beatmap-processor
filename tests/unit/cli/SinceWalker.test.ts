import { formatOsuDate } from "@/beatmaps/converter";
import { computeNextCursor, walkSince, walkStart } from "@/cli/SinceWalker";
import { OsuUnavailableError } from "@/osu/errors";
import { buildApiBeatmap } from "@test/fixtures/osu/beatmaps";
import { captureOutput } from "@test/utils/cli";
import { FakeCursorRepository } from "@test/fakes/FakeCursorRepository";
import { FakeOsuGateway } from "@test/fakes/FakeOsuGateway";
import type { OsuAPIResponse } from "@rian8337/osu-base";
import { describe, expect, it, vi } from "vitest";

const base = Date.parse("2010-01-01T00:00:00Z");

/**
 * `count` ranked beatmaps approved one minute apart (or all at once with `sameDate`).
 */
function buildRankedBeatmaps(
    count: number,
    sameDate = false,
): OsuAPIResponse[] {
    return Array.from({ length: count }, (_, i) =>
        buildApiBeatmap({
            beatmap_id: (i + 1).toString(),
            beatmapset_id: (i + 1).toString(),
            approved_date: formatOsuDate(
                new Date(base + (sameDate ? 0 : i * 60_000)),
            ),
            file_md5: (i + 1).toString(16).padStart(32, "0"),
        }),
    );
}

function setup(...responses: OsuAPIResponse[]) {
    const osuGateway = new FakeOsuGateway().addBeatmaps(...responses);
    const cursorRepository = new FakeCursorRepository();
    const output = captureOutput();
    const sleep = vi.fn((_ms: number) => Promise.resolve());

    return {
        osuGateway,
        cursorRepository,
        output,
        sleep,
        deps: { osuGateway, cursorRepository, output, sleep },
    };
}

describe("computeNextCursor", () => {
    const cursor = new Date("2010-01-01T00:00:00Z");

    it("steps back one second from the last approval date", () => {
        expect(
            computeNextCursor(cursor, new Date("2010-01-02T00:00:00Z")),
        ).toEqual({
            next: new Date("2010-01-01T23:59:59Z"),
            skipped: false,
        });
    });

    it("always moves forward, reporting a possible skip", () => {
        expect(computeNextCursor(cursor, cursor)).toEqual({
            next: new Date("2010-01-01T00:00:01Z"),
            skipped: true,
        });
        expect(
            computeNextCursor(cursor, new Date("2010-01-01T00:00:01Z")),
        ).toEqual({
            next: new Date("2010-01-01T00:00:01Z"),
            skipped: true,
        });
    });
});

describe("walkSince", () => {
    it("walks every page with overlap and stops on a short page", async () => {
        const { osuGateway, cursorRepository, deps } = setup(
            ...buildRankedBeatmaps(1200),
        );
        const seen = new Set<string>();

        const result = await walkSince(deps, {
            command: "test",
            shouldRestart: false,
            processPage: async (page) => {
                for (const beatmap of page) {
                    seen.add(beatmap.beatmap_id);
                }
            },
        });

        expect(seen.size).toBe(1200);
        expect(result.pages).toBe(3);
        expect(osuGateway.calls[0]).toBe(
            `getBeatmapsSince bulk ${formatOsuDate(walkStart)}`,
        );
        // Resumes one second before the last beatmap, so a later run sees maps approved since.
        expect(await cursorRepository.getCursor("test")).toEqual(
            new Date(base + 1199 * 60_000 - 1000),
        );
    });

    it("resumes from the saved cursor, or from the start with restart", async () => {
        const { osuGateway, cursorRepository, deps } = setup(
            ...buildRankedBeatmaps(3),
        );
        const saved = new Date(base + 60_000);

        await cursorRepository.setCursor("test", saved);
        await walkSince(deps, {
            command: "test",
            shouldRestart: false,
            processPage: async () => {},
        });

        expect(osuGateway.calls).toEqual([
            `getBeatmapsSince bulk ${formatOsuDate(saved)}`,
        ]);

        await walkSince(deps, {
            command: "test",
            shouldRestart: true,
            processPage: async () => {},
        });

        expect(osuGateway.calls[1]).toBe(
            `getBeatmapsSince bulk ${formatOsuDate(walkStart)}`,
        );
    });

    it("waits out an unavailable osu! and asks for the same page again", async () => {
        const { cursorRepository, output, sleep } = setup();
        const getBeatmapsSince = vi
            .fn<(lane: string, since: Date) => Promise<OsuAPIResponse[]>>()
            .mockRejectedValueOnce(new OsuUnavailableError(7))
            .mockResolvedValueOnce(buildRankedBeatmaps(2));
        const pages: number[] = [];

        await walkSince(
            {
                osuGateway: { getBeatmapsSince },
                cursorRepository,
                output,
                sleep,
            },
            {
                command: "test",
                shouldRestart: false,
                processPage: async (page) => void pages.push(page.length),
            },
        );

        expect(sleep).toHaveBeenCalledWith(7000);
        expect(getBeatmapsSince.mock.calls.map(([, since]) => since)).toEqual([
            walkStart,
            walkStart,
        ]);
        expect(pages).toEqual([2]);
    });

    it("moves past 500 beatmaps approved in the same second, and says so", async () => {
        const { output, deps } = setup(...buildRankedBeatmaps(600, true));
        const seen = new Set<string>();

        await walkSince(deps, {
            command: "test",
            shouldRestart: false,
            processPage: async (page) => {
                for (const beatmap of page) {
                    seen.add(beatmap.beatmap_id);
                }
            },
        });

        // osu! only ever lists the first 500 of that second; the walk ends instead of looping.
        expect(seen.size).toBe(500);
        expect(output.lines.join("\n")).toMatch(/may have been skipped/);
    });

    it("keeps the cursor when a page fails, so a rerun repeats it", async () => {
        const { cursorRepository, deps } = setup(...buildRankedBeatmaps(3));

        await expect(
            walkSince(deps, {
                command: "test",
                shouldRestart: false,
                processPage: () => Promise.reject(new Error("database down")),
            }),
        ).rejects.toThrow("database down");
        expect(await cursorRepository.getCursor("test")).toBeNull();
    });

    it("stops on an error other than osu! being unavailable, without waiting", async () => {
        const { cursorRepository, output, sleep } = setup();
        const getBeatmapsSince = vi
            .fn<(lane: string, since: Date) => Promise<OsuAPIResponse[]>>()
            .mockRejectedValue(new Error("bad response"));

        await expect(
            walkSince(
                {
                    osuGateway: { getBeatmapsSince },
                    cursorRepository,
                    output,
                    sleep,
                },
                {
                    command: "test",
                    shouldRestart: false,
                    processPage: async () => {},
                },
            ),
        ).rejects.toThrow("bad response");
        expect(sleep).not.toHaveBeenCalled();
        expect(getBeatmapsSince).toHaveBeenCalledTimes(1);
    });

    it("refuses a page whose last beatmap has no approval date", async () => {
        const { cursorRepository, output, sleep } = setup();
        const getBeatmapsSince = vi
            .fn<(lane: string, since: Date) => Promise<OsuAPIResponse[]>>()
            .mockResolvedValue([
                buildApiBeatmap({ beatmap_id: "9", approved_date: null }),
            ]);

        await expect(
            walkSince(
                {
                    osuGateway: { getBeatmapsSince },
                    cursorRepository,
                    output,
                    sleep,
                },
                {
                    command: "test",
                    shouldRestart: false,
                    processPage: async () => {},
                },
            ),
        ).rejects.toThrow("osu! listed beatmap 9 without an approval date");
        expect(await cursorRepository.getCursor("test")).toBeNull();
    });
});
