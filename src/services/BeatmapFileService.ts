import { computeMD5 } from "@/beatmaps/md5";
import type { BeatmapRow } from "@/database/types";
import { dependencyTokens } from "@/dependencies/tokens";
import { OsuUnavailableError, type Lane } from "@/osu/errors";
import type { IOsuGateway } from "@/osu/IOsuGateway";
import type { IBeatmapFileStore } from "@/repositories/IBeatmapFileStore";
import { Injectable } from "@/server";
import { getErrorMessage } from "@/utils/getErrorMessage";
import { InFlight } from "@/utils/InFlight";
import { BeatmapDecoder } from "@rian8337/osu-base";
import { inject } from "tsyringe";
import type { IBeatmapFileService } from "./IBeatmapFileService";
import type { IBeatmapService } from "./IBeatmapService";

/**
 * `Retry-After` when osu! serves a file that matches no metadata: osu! is mid-update, so asking again soon is right.
 */
const inconsistentRetryAfterSeconds = 5;

@Injectable(dependencyTokens.beatmapFileService)
export class BeatmapFileService implements IBeatmapFileService {
    private readonly pendingDownloads = new InFlight<string, Buffer | null>();

    constructor(
        @inject(dependencyTokens.beatmapFileStore)
        private readonly beatmapFileStore: IBeatmapFileStore,
        @inject(dependencyTokens.osuGateway)
        private readonly osuGateway: Pick<IOsuGateway, "downloadFile">,
        @inject(dependencyTokens.beatmapService)
        private readonly beatmapService: Pick<
            IBeatmapService,
            "refreshBeatmap" | "setMaxCombo"
        >,
    ) {}

    getBeatmapFile(lane: Lane, beatmap: BeatmapRow): Promise<Buffer | null> {
        // Shared regardless of lane: one download per beatmap version.
        return this.pendingDownloads.run(
            `${beatmap.beatmapId.toString()}:${beatmap.fileMd5}`,
            () => this.loadFile(lane, beatmap),
        );
    }

    backfillMaxCombo(beatmap: BeatmapRow, file: Buffer): void {
        if (beatmap.maxCombo !== null) {
            return;
        }

        // After the response: decoding takes a moment and must not delay it.
        setImmediate(() => {
            void (async () => {
                try {
                    const { maxCombo } = new BeatmapDecoder().decode(
                        file.toString(),
                    ).result;

                    await this.beatmapService.setMaxCombo(
                        beatmap.beatmapId,
                        maxCombo,
                    );
                } catch (e) {
                    console.error(
                        `Failed to backfill the max combo of beatmap ${beatmap.beatmapId.toString()}:`,
                        getErrorMessage(e),
                    );
                }
            })();
        });
    }

    private async loadFile(
        lane: Lane,
        beatmap: BeatmapRow,
    ): Promise<Buffer | null> {
        const id = beatmap.beatmapId;
        const stored = await this.beatmapFileStore
            .read(id)
            .catch((e: unknown) => {
                console.error(
                    `Failed to read the file of beatmap ${id.toString()}:`,
                    getErrorMessage(e),
                );

                return null;
            });

        if (stored) {
            if (computeMD5(stored) === beatmap.fileMd5) {
                return stored;
            }

            // Truncated, corrupt, or an older version.
            await this.beatmapFileStore.delete(id).catch((e: unknown) => {
                console.error(
                    `Failed to delete the stale file of beatmap ${id.toString()}:`,
                    getErrorMessage(e),
                );
            });
        }

        const downloaded = await this.osuGateway.downloadFile(lane, id);

        if (!downloaded) {
            return null;
        }

        const hash = computeMD5(downloaded);

        if (hash !== beatmap.fileMd5) {
            // The beatmap may have been updated after its metadata was fetched.
            const current = await this.beatmapService.refreshBeatmap(lane, id);

            if (current?.fileMd5 !== hash) {
                console.error(
                    `osu! served a file for beatmap ${id.toString()} that matches neither its stored nor its current metadata`,
                );

                throw new OsuUnavailableError(inconsistentRetryAfterSeconds);
            }
        }

        try {
            await this.beatmapFileStore.write(id, downloaded);
        } catch (e) {
            console.error(
                `Failed to store the file of beatmap ${id.toString()}:`,
                getErrorMessage(e),
            );
        }

        return downloaded;
    }
}
