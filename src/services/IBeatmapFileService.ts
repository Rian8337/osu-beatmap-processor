import type { BeatmapRow } from "@/database/types";
import type { Lane } from "@/osu/errors";

export interface IBeatmapFileService {
    /**
     * The beatmap's `.osu` file, checked against its `fileMd5`: from the store, or downloaded and stored. `null` if
     * osu! has no file for it.
     *
     * @throws {OsuUnavailableError} If osu! cannot be asked, or serves a file that matches neither the stored nor
     * the current metadata.
     */
    getBeatmapFile(lane: Lane, beatmap: BeatmapRow): Promise<Buffer | null>;

    /**
     * When the beatmap has no max combo, computes it from the file and stores it, in the background. A failure is
     * logged.
     */
    backfillMaxCombo(beatmap: BeatmapRow, file: Buffer): void;
}
