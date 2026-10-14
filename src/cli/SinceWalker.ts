import { formatOsuDate, parseOsuDate } from "@/beatmaps/converter";
import { OsuUnavailableError } from "@/osu/errors";
import type { IOsuGateway } from "@/osu/IOsuGateway";
import { sincePageSize } from "@/osu/OsuGateway";
import type { ICursorRepository } from "@/repositories/ICursorRepository";
import type { OsuAPIResponse } from "@rian8337/osu-base";
import type { CliOutput } from "./types";

/**
 * Before the first ranked beatmap.
 */
export const walkStart = new Date("2007-01-01T00:00:00Z");

export interface SinceWalkDependencies {
    readonly osuGateway: Pick<IOsuGateway, "getBeatmapsSince">;
    readonly cursorRepository: ICursorRepository;
    readonly output: CliOutput;
    readonly sleep: (ms: number) => Promise<void>;
}

export interface SinceWalkOptions {
    /** The cursor's name, e.g. "populate-cache". */
    readonly command: string;
    /** Start from `walkStart` instead of the saved cursor. */
    readonly shouldRestart: boolean;
    /** Handles one page; the cursor moves past the page only after this resolves. */
    readonly processPage: (page: readonly OsuAPIResponse[]) => Promise<void>;
}

/**
 * Where the next page starts: one second before the page's last approval date, so that pages overlap by their last
 * second and maps tied at a boundary are not lost whether osu! compares `since` inclusively or exclusively. If that
 * would not move past `cursor` (a whole page within one second), the later of `lastApproved` and `cursor` + 1 s,
 * which may skip maps.
 */
export function computeNextCursor(
    cursor: Date,
    lastApproved: Date,
): { next: Date; skipped: boolean } {
    const overlap = new Date(lastApproved.getTime() - 1000);

    if (overlap > cursor) {
        return { next: overlap, skipped: false };
    }

    return {
        next: new Date(
            Math.max(lastApproved.getTime(), cursor.getTime() + 1000),
        ),
        skipped: true,
    };
}

/**
 * Walks every osu!standard beatmap approved since the saved cursor (ranked, approved, loved, and qualified), 500 per
 * osu! call on the bulk lane. A refused or rate-limited call waits out its `Retry-After` and is repeated; any other
 * failure stops the walk, and a rerun resumes from the saved cursor.
 */
export async function walkSince(
    deps: SinceWalkDependencies,
    options: SinceWalkOptions,
): Promise<{ pages: number; beatmaps: number }> {
    if (options.shouldRestart) {
        await deps.cursorRepository.clearCursor(options.command);
    }

    let cursor =
        (await deps.cursorRepository.getCursor(options.command)) ?? walkStart;
    let pages = 0;
    let beatmaps = 0;

    for (;;) {
        let page: OsuAPIResponse[];

        try {
            page = await deps.osuGateway.getBeatmapsSince("bulk", cursor);
        } catch (e) {
            if (e instanceof OsuUnavailableError) {
                deps.output.info(
                    `osu! is unavailable; retrying in ${e.retryAfterSeconds.toString()} s`,
                );
                await deps.sleep(e.retryAfterSeconds * 1000);

                continue;
            }

            throw e;
        }

        await options.processPage(page);
        pages++;
        beatmaps += page.length;

        const last = page.at(-1);

        if (last) {
            if (last.approved_date === null) {
                throw new Error(
                    `osu! listed beatmap ${last.beatmap_id} without an approval date`,
                );
            }

            const { next, skipped } = computeNextCursor(
                cursor,
                parseOsuDate(last.approved_date),
            );

            if (skipped) {
                deps.output.info(
                    `More than ${sincePageSize.toString()} beatmaps were approved at ${formatOsuDate(cursor)}; some may have been skipped`,
                );
            }

            cursor = next;
            await deps.cursorRepository.setCursor(options.command, cursor);
        }

        if (page.length < sincePageSize) {
            return { pages, beatmaps };
        }
    }
}
