import type { BeatmapRow } from "@/database/types";

/**
 * Keeps the stored max combo when osu! sends none for the same file: the stored one was backfilled from the file.
 * Another file (hash) drops it, since the backfilled value described the old file.
 *
 * @param fresh The row built from osu!'s answer.
 * @param stored The row stored so far, if any.
 */
export function keepStoredMaxCombo(
    fresh: BeatmapRow,
    stored: Pick<BeatmapRow, "fileMd5" | "maxCombo"> | undefined,
): BeatmapRow {
    if (
        fresh.maxCombo !== null ||
        !stored ||
        stored.fileMd5 !== fresh.fileMd5
    ) {
        return fresh;
    }

    return { ...fresh, maxCombo: stored.maxCombo };
}
