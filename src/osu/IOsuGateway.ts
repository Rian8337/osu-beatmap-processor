import type { OsuAPIResponse } from "@rian8337/osu-base";
import type { Lane } from "./errors";

export interface IOsuGateway {
    /** The osu!standard beatmap, `null` if osu! has none. @throws {OsuUnavailableError} */
    getBeatmap(
        lane: Lane,
        idOrHash: number | string,
    ): Promise<OsuAPIResponse | null>;

    /** Every beatmap of the set (all modes), `null` if osu! has none. @throws {OsuUnavailableError} */
    getBeatmapset(lane: Lane, id: number): Promise<OsuAPIResponse[] | null>;

    /** The `.osu` file, `null` if osu! has none. @throws {OsuUnavailableError} */
    downloadFile(lane: Lane, id: number): Promise<Buffer | null>;

    /** Like `getBeatmap`, but `undefined` at once unless the limiter is idle. @throws {OsuUnavailableError} */
    tryGetBeatmapNow(
        lane: Lane,
        idOrHash: number | string,
    ): Promise<OsuAPIResponse | null | undefined>;

    /** Like `getBeatmapset`, but `undefined` at once unless the limiter is idle. @throws {OsuUnavailableError} */
    tryGetBeatmapsetNow(
        lane: Lane,
        id: number,
    ): Promise<OsuAPIResponse[] | null | undefined>;

    /** Up to 500 osu!standard beatmaps approved from `since` on, in approval order. @throws {OsuUnavailableError} */
    getBeatmapsSince(lane: Lane, since: Date): Promise<OsuAPIResponse[]>;
}
