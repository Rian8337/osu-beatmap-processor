import { formatOsuDate } from "@/beatmaps/converter";
import { OsuUnavailableError, type Lane } from "@/osu/errors";
import type { IOsuGateway } from "@/osu/IOsuGateway";
import type { OsuAPIResponse } from "@rian8337/osu-base";

/**
 * osu! in memory. Every call is recorded in `calls` as `"<method> <lane> <argument>"`.
 */
export class FakeOsuGateway implements IOsuGateway {
    readonly beatmaps = new Map<number, OsuAPIResponse>();
    readonly files = new Map<number, Buffer>();
    readonly calls: string[] = [];

    /** The `tryGet…Now` methods answer `undefined`, as when the limiter is busy. */
    isBusy = false;

    /** When set, every call fails with an `OsuUnavailableError` with this many seconds. */
    unavailableForSeconds: number | null = null;

    /** When set, calls wait for it before answering. */
    gate: Promise<void> | null = null;

    addBeatmaps(...responses: OsuAPIResponse[]): this {
        for (const response of responses) {
            this.beatmaps.set(Number(response.beatmap_id), response);
        }

        return this;
    }

    getBeatmap(
        lane: Lane,
        idOrHash: number | string,
    ): Promise<OsuAPIResponse | null> {
        return this.answer(`getBeatmap ${lane} ${String(idOrHash)}`, () =>
            this.findBeatmap(idOrHash),
        );
    }

    getBeatmapset(lane: Lane, id: number): Promise<OsuAPIResponse[] | null> {
        return this.answer(`getBeatmapset ${lane} ${id.toString()}`, () =>
            this.findBeatmapset(id),
        );
    }

    downloadFile(lane: Lane, id: number): Promise<Buffer | null> {
        return this.answer(
            `downloadFile ${lane} ${id.toString()}`,
            () => this.files.get(id) ?? null,
        );
    }

    tryGetBeatmapNow(
        lane: Lane,
        idOrHash: number | string,
    ): Promise<OsuAPIResponse | null | undefined> {
        return this.answerNow(
            `tryGetBeatmapNow ${lane} ${String(idOrHash)}`,
            () => this.findBeatmap(idOrHash),
        );
    }

    tryGetBeatmapsetNow(
        lane: Lane,
        id: number,
    ): Promise<OsuAPIResponse[] | null | undefined> {
        return this.answerNow(
            `tryGetBeatmapsetNow ${lane} ${id.toString()}`,
            () => this.findBeatmapset(id),
        );
    }

    getBeatmapsSince(lane: Lane, since: Date): Promise<OsuAPIResponse[]> {
        const from = formatOsuDate(since);

        return this.answer(`getBeatmapsSince ${lane} ${from}`, () =>
            [...this.beatmaps.values()]
                .filter(
                    (b) =>
                        b.mode === "0" &&
                        b.approved_date !== null &&
                        b.approved_date >= from,
                )
                .sort(
                    (a, b) =>
                        (a.approved_date ?? "").localeCompare(
                            b.approved_date ?? "",
                        ) || Number(a.beatmap_id) - Number(b.beatmap_id),
                )
                .slice(0, 500),
        );
    }

    private findBeatmap(idOrHash: number | string): OsuAPIResponse | null {
        const found =
            typeof idOrHash === "number"
                ? this.beatmaps.get(idOrHash)
                : [...this.beatmaps.values()].find(
                      (b) => b.file_md5 === idOrHash,
                  );

        return found?.mode === "0" ? found : null;
    }

    private findBeatmapset(id: number): OsuAPIResponse[] | null {
        const list = [...this.beatmaps.values()].filter(
            (b) => b.beatmapset_id === id.toString(),
        );

        return list.length > 0 ? list : null;
    }

    private async answer<T>(call: string, value: () => T): Promise<T> {
        this.calls.push(call);

        if (this.gate) {
            await this.gate;
        }

        if (this.unavailableForSeconds !== null) {
            throw new OsuUnavailableError(this.unavailableForSeconds);
        }

        return value();
    }

    private answerNow<T>(call: string, value: () => T): Promise<T | undefined> {
        if (this.isBusy) {
            this.calls.push(`${call} (busy)`);

            return Promise.resolve(undefined);
        }

        return this.answer(call, value);
    }
}
