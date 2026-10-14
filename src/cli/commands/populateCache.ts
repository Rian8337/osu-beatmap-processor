import { convertApiResponseToRow } from "@/beatmaps/converter";
import { keepStoredMaxCombo } from "@/beatmaps/maxCombo";
import { computeMD5 } from "@/beatmaps/md5";
import { expectPositionals, parseArguments } from "@/cli/arguments";
import { CliError } from "@/cli/errors";
import { walkSince } from "@/cli/SinceWalker";
import type { CliOutput, Command } from "@/cli/types";
import type { BeatmapRow } from "@/database/types";
import { BeatmapFileStore } from "@/repositories/BeatmapFileStore";
import { BeatmapRepository } from "@/repositories/BeatmapRepository";
import { CursorRepository } from "@/repositories/CursorRepository";
import { getErrorMessage } from "@/utils/getErrorMessage";
import { RankedStatus } from "@rian8337/osu-base";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

function hasErrorCode(error: unknown, ...codes: string[]): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string" &&
        codes.includes(error.code)
    );
}

async function isDirectory(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isDirectory();
    } catch (e) {
        // Missing, or below a file.
        if (hasErrorCode(e, "ENOENT", "ENOTDIR")) {
            return false;
        }

        throw e;
    }
}

/**
 * What happened to a beatmap's file in the dump: `copied`; `missing` (not in the dump, whether it was never there or an
 * earlier `--move` already took it); `mismatched` (its MD5 is not the beatmap's); or `failed` (the dump file could not
 * be read).
 */
type FileOutcome = "copied" | "missing" | "mismatched" | "failed";

/**
 * Copies (or moves) a beatmap's file from an extracted osu! file dump when its MD5 matches.
 *
 * Only problems with the dump are handled here, since one bad dump file must not stop the walk: it is reported and the
 * file is downloaded on demand later. A failure to write the store propagates, because it affects every file.
 */
async function importFile(
    store: BeatmapFileStore,
    output: CliOutput,
    directory: string,
    row: BeatmapRow,
    move: boolean,
): Promise<FileOutcome> {
    const id = row.beatmapId.toString();
    const source = join(directory, `${id}.osu`);
    let data: Buffer;

    try {
        data = await readFile(source);
    } catch (e) {
        if (hasErrorCode(e, "ENOENT")) {
            return "missing";
        }

        output.error(
            `Failed to read the file of beatmap ${id} from the dump: ${getErrorMessage(e)}`,
        );

        return "failed";
    }

    if (computeMD5(data) !== row.fileMd5) {
        return "mismatched";
    }

    await store.write(row.beatmapId, data);

    if (move) {
        try {
            await rm(source);
        } catch (e) {
            output.error(
                `Copied beatmap ${id} but could not remove it from the dump: ${getErrorMessage(e)}`,
            );
        }
    }

    return "copied";
}

/**
 * Stores every ranked and approved osu!standard beatmap from osu!'s approval-date listing (about 500 osu! calls),
 * and with `--files`, takes their `.osu` files from an extracted osu! file dump instead of downloading them. Files
 * that are missing from the dump or do not match are downloaded on demand later.
 */
export const populateCache: Command = (args) => {
    const { values, positionals } = parseArguments(args, {
        files: { type: "string" },
        move: { type: "boolean", default: false },
        restart: { type: "boolean", default: false },
    });

    expectPositionals(positionals, []);

    const { files: dump, move, restart } = values;

    if (move && dump === undefined) {
        throw new CliError("--move needs --files <dump directory>");
    }

    return async (deps) => {
        if (dump !== undefined && !(await isDirectory(dump))) {
            throw new CliError(`${dump} is not a directory`);
        }

        const config = deps.loadConfig();
        const beatmaps = new BeatmapRepository(deps.db);
        const store = new BeatmapFileStore(config);
        const totals = {
            stored: 0,
            copied: 0,
            missing: 0,
            mismatched: 0,
            failed: 0,
        };
        // Overlapping pages deliver some beatmaps twice: count and import each once, so that moving a file does not
        // turn its second delivery into a "missing" one.
        const handledIds = new Set<number>();
        const describeTotals = () =>
            `${totals.stored.toString()} beatmaps stored, ${totals.copied.toString()} files copied, ${totals.missing.toString()} missing, ${totals.mismatched.toString()} mismatched${totals.failed > 0 ? `, ${totals.failed.toString()} failed` : ""}`;

        await walkSince(
            {
                osuGateway: deps.createOsuGateway(config),
                cursorRepository: new CursorRepository(deps.db),
                output: deps.output,
                sleep: deps.sleep,
            },
            {
                command: "populate-cache",
                shouldRestart: restart,
                processPage: async (page) => {
                    const fresh = page
                        .filter((response) => {
                            const status = Number(response.approved);

                            return (
                                status === RankedStatus.Ranked ||
                                status === RankedStatus.Approved
                            );
                        })
                        .map((response) => convertApiResponseToRow(response));
                    const stored = new Map(
                        (
                            await beatmaps.findByIds(
                                fresh.map((row) => row.beatmapId),
                            )
                        ).map((row) => [row.beatmapId, row]),
                    );
                    const rows = fresh.map((row) =>
                        keepStoredMaxCombo(row, stored.get(row.beatmapId)),
                    );

                    await beatmaps.upsert(rows);

                    const newRows = rows.filter(
                        (row) => !handledIds.has(row.beatmapId),
                    );

                    for (const row of newRows) {
                        handledIds.add(row.beatmapId);
                    }

                    totals.stored += newRows.length;

                    if (dump !== undefined) {
                        for (const row of newRows) {
                            totals[
                                await importFile(
                                    store,
                                    deps.output,
                                    dump,
                                    row,
                                    move,
                                )
                            ]++;
                        }
                    }

                    const last = page.at(-1);

                    if (last) {
                        deps.output.info(
                            `Up to ${last.approved_date ?? "?"}: ${describeTotals()}`,
                        );
                    }
                },
            },
        );

        deps.output.info(`Done: ${describeTotals()}`);
    };
};
