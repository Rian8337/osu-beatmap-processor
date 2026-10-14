import { convertApiResponseToRow } from "@/beatmaps/converter";
import { expectPositionals, parseArguments } from "@/cli/arguments";
import { walkSince } from "@/cli/SinceWalker";
import type { Command } from "@/cli/types";
import { BeatmapRepository } from "@/repositories/BeatmapRepository";
import { CursorRepository } from "@/repositories/CursorRepository";
import { RankedStatus } from "@rian8337/osu-base";

const neverRechecked = new Set<number>([
    RankedStatus.Ranked,
    RankedStatus.Approved,
    RankedStatus.Loved,
]);

const isSameTime = (a: Date | null, b: Date | null) =>
    a?.getTime() === b?.getTime();

/**
 * Overwrites the dates and status of stored ranked, approved, and loved beatmaps with osu!'s (UTC) values. These rows
 * are never re-checked, so rows written in UTC+8 before the rewrite keep their wrong dates otherwise. Inserts
 * nothing; other rows heal at their next re-check, as do rows whose file osu! has changed (left untouched, counted
 * as skipped).
 */
export const fixDates: Command = (args) => {
    const { values, positionals } = parseArguments(args, {
        restart: { type: "boolean", default: false },
    });

    expectPositionals(positionals, []);

    return async (deps) => {
        const config = deps.loadConfig();
        const beatmaps = new BeatmapRepository(deps.db);
        const totals = { checked: 0, corrected: 0, changedFiles: 0 };
        // Overlapping pages deliver some beatmaps twice: count each once.
        const checkedIds = new Set<number>();

        await walkSince(
            {
                osuGateway: deps.createOsuGateway(config),
                cursorRepository: new CursorRepository(deps.db),
                output: deps.output,
                sleep: deps.sleep,
            },
            {
                command: "fix-dates",
                shouldRestart: values.restart,
                processPage: async (page) => {
                    const fresh = page
                        .filter((response) =>
                            neverRechecked.has(Number(response.approved)),
                        )
                        .map((response) => convertApiResponseToRow(response));
                    const stored = new Map(
                        (
                            await beatmaps.findByIds(
                                fresh.map((row) => row.beatmapId),
                            )
                        ).map((row) => [row.beatmapId, row]),
                    );

                    for (const row of fresh) {
                        const old = stored.get(row.beatmapId);

                        if (!old) {
                            continue;
                        }

                        const isFirstSighting = !checkedIds.has(row.beatmapId);

                        if (isFirstSighting) {
                            checkedIds.add(row.beatmapId);
                            totals.checked++;
                        }

                        // A stored row whose file osu! has since changed is stale: leave it for its normal re-check to
                        // find, instead of freezing the old hash as ranked or loved.
                        if (old.fileMd5 !== row.fileMd5) {
                            if (isFirstSighting) {
                                totals.changedFiles++;
                            }

                            continue;
                        }

                        if (
                            old.approved === row.approved &&
                            isSameTime(old.submitDate, row.submitDate) &&
                            isSameTime(old.approvedDate, row.approvedDate) &&
                            isSameTime(old.lastUpdate, row.lastUpdate)
                        ) {
                            continue;
                        }

                        await beatmaps.update(row.beatmapId, {
                            approved: row.approved,
                            submitDate: row.submitDate,
                            approvedDate: row.approvedDate,
                            lastUpdate: row.lastUpdate,
                            lastChecked: new Date(),
                        });
                        totals.corrected++;
                    }

                    const last = page.at(-1);

                    if (last) {
                        deps.output.info(
                            `Up to ${last.approved_date ?? "?"}: ${totals.checked.toString()} checked, ${totals.corrected.toString()} corrected`,
                        );
                    }
                },
            },
        );

        deps.output.info(
            `Done: ${totals.checked.toString()} stored beatmaps checked, ${totals.corrected.toString()} corrected, ${totals.changedFiles.toString()} skipped (file changed)`,
        );
    };
};
