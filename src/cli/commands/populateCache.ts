import { convertApiResponseToRow } from "@/beatmaps/converter";
import { computeMD5 } from "@/beatmaps/md5";
import { expectPositionals, parseArguments } from "@/cli/arguments";
import { CliError } from "@/cli/errors";
import { walkSince } from "@/cli/SinceWalker";
import type { Command } from "@/cli/types";
import type { BeatmapRow } from "@/database/types";
import { BeatmapFileStore } from "@/repositories/BeatmapFileStore";
import { BeatmapRepository } from "@/repositories/BeatmapRepository";
import { CursorRepository } from "@/repositories/CursorRepository";
import { getErrorMessage } from "@/utils/getErrorMessage";
import { RankedStatus } from "@rian8337/osu-base";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

type FileOutcome = "copied" | "missing" | "mismatched";

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
 * Copies (or moves) a beatmap's file from an extracted osu! file dump when its MD5 matches.
 */
async function importFile(
    store: BeatmapFileStore,
    directory: string,
    row: BeatmapRow,
    move: boolean,
): Promise<FileOutcome> {
    const source = join(directory, `${row.beatmapId.toString()}.osu`);
    let data: Buffer;

    try {
        data = await readFile(source);
    } catch (e) {
        if (hasErrorCode(e, "ENOENT")) {
            return "missing";
        }

        throw e;
    }

    if (computeMD5(data) !== row.fileMd5) {
        return "mismatched";
    }

    await store.write(row.beatmapId, data);

    if (move) {
        await rm(source);
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
                    const rows = page
                        .filter((response) => {
                            const status = Number(response.approved);

                            return (
                                status === RankedStatus.Ranked ||
                                status === RankedStatus.Approved
                            );
                        })
                        .map((response) => convertApiResponseToRow(response));

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
                            // One unreadable or unwritable file must not stop the walk: the beatmap is stored, and its
                            // file is downloaded on demand later.
                            try {
                                totals[
                                    await importFile(store, dump, row, move)
                                ]++;
                            } catch (e) {
                                totals.failed++;
                                deps.output.error(
                                    `Failed to import the file of beatmap ${row.beatmapId.toString()}: ${getErrorMessage(e)}`,
                                );
                            }
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
