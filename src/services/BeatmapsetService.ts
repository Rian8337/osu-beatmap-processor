import { convertApiResponseToRow } from "@/beatmaps/converter";
import {
    isRecheckDue,
    getBeatmapsetRecheckIntervalMs,
} from "@/beatmaps/recheck";
import { LruCache } from "@/cache/LruCache";
import type { Config } from "@/config/config";
import type { BeatmapRow } from "@/database/types";
import { dependencyTokens } from "@/dependencies/tokens";
import { OsuUnavailableError, type Lane } from "@/osu/errors";
import type { IOsuGateway } from "@/osu/IOsuGateway";
import type { IBeatmapFileStore } from "@/repositories/IBeatmapFileStore";
import type { IBeatmapRepository } from "@/repositories/IBeatmapRepository";
import type { IBeatmapsetRepository } from "@/repositories/IBeatmapsetRepository";
import { Injectable } from "@/server";
import { getErrorMessage } from "@/utils/getErrorMessage";
import { InFlight } from "@/utils/InFlight";
import type { OsuAPIResponse } from "@rian8337/osu-base";
import { inject } from "tsyringe";
import { cacheLifetimeMs } from "./cacheLifetime";
import type { IBeatmapService } from "./IBeatmapService";
import type { IBeatmapsetService } from "./IBeatmapsetService";

interface CachedSet {
    readonly rows: readonly BeatmapRow[];
    readonly lastChecked: Date;
}

const byBeatmapId = (a: BeatmapRow, b: BeatmapRow) => a.beatmapId - b.beatmapId;

/**
 * Whole beatmapsets. The memory cache may serve a set for up to its lifetime after a single-beatmap lookup found one
 * of its beatmaps changed; the stored set is marked incomplete at once, so the database never serves it stale.
 */
@Injectable(dependencyTokens.beatmapsetService)
export class BeatmapsetService implements IBeatmapsetService {
    private readonly beatmapsetCache: LruCache<number, CachedSet>;
    private readonly pendingLookups = new InFlight<
        number,
        readonly BeatmapRow[] | null
    >();

    constructor(
        @inject(dependencyTokens.config)
        private readonly config: Pick<Config, "cacheSize" | "recheckMinutes">,
        @inject(dependencyTokens.beatmapsetRepository)
        private readonly beatmapsetRepository: IBeatmapsetRepository,
        @inject(dependencyTokens.beatmapRepository)
        private readonly beatmapRepository: Pick<
            IBeatmapRepository,
            "findByBeatmapsetId"
        >,
        @inject(dependencyTokens.beatmapService)
        private readonly beatmapService: Pick<
            IBeatmapService,
            "cacheBeatmaps" | "evictBeatmap"
        >,
        @inject(dependencyTokens.beatmapFileStore)
        private readonly beatmapFileStore: Pick<IBeatmapFileStore, "delete">,
        @inject(dependencyTokens.osuGateway)
        private readonly osuGateway: Pick<
            IOsuGateway,
            "getBeatmapset" | "tryGetBeatmapsetNow"
        >,
    ) {
        this.beatmapsetCache = new LruCache(
            config.cacheSize.beatmapsets,
            cacheLifetimeMs,
        );
    }

    getBeatmapset(
        lane: Lane,
        beatmapsetId: number,
    ): Promise<readonly BeatmapRow[] | null> {
        return this.pendingLookups.run(beatmapsetId, () =>
            this.lookup(lane, beatmapsetId),
        );
    }

    private async lookup(
        lane: Lane,
        beatmapsetId: number,
    ): Promise<readonly BeatmapRow[] | null> {
        // A failed database read throws DatabaseUnavailableError here, before osu! is asked.
        const remembered = this.beatmapsetCache.get(beatmapsetId);
        const cached =
            remembered ?? (await this.loadFromDatabase(beatmapsetId));

        if (!cached) {
            return this.storeBeatmapset(
                beatmapsetId,
                await this.osuGateway.getBeatmapset(lane, beatmapsetId),
                null,
            );
        }

        // A memory hit that was not re-checked keeps its original expiry.
        if (!this.needsRecheck(cached)) {
            return this.rememberBeatmapset(beatmapsetId, cached, remembered);
        }

        let responses: OsuAPIResponse[] | null | undefined;

        try {
            responses = await this.osuGateway.tryGetBeatmapsetNow(
                lane,
                beatmapsetId,
            );
        } catch (e) {
            if (!(e instanceof OsuUnavailableError)) {
                throw e;
            }

            console.error(
                `Failed to re-check beatmapset ${beatmapsetId.toString()}:`,
                getErrorMessage(e),
            );
        }

        if (responses === undefined) {
            // Busy or unavailable: serve the stored set unchanged.
            return this.rememberBeatmapset(beatmapsetId, cached, remembered);
        }

        return this.storeBeatmapset(beatmapsetId, responses, cached.rows);
    }

    /**
     * Caches an entry read from the database; one already in memory is returned as is, as setting it again would
     * restart its expiry.
     */
    private rememberBeatmapset(
        beatmapsetId: number,
        cached: CachedSet,
        remembered: CachedSet | undefined,
    ): readonly BeatmapRow[] {
        if (cached !== remembered) {
            this.beatmapsetCache.set(beatmapsetId, cached);
        }

        return cached.rows;
    }

    private async loadFromDatabase(
        beatmapsetId: number,
    ): Promise<CachedSet | null> {
        const lastChecked =
            await this.beatmapsetRepository.findLastChecked(beatmapsetId);

        if (!lastChecked) {
            return null;
        }

        const rows =
            await this.beatmapRepository.findByBeatmapsetId(beatmapsetId);

        return { rows: this.beatmapService.cacheBeatmaps(rows), lastChecked };
    }

    /**
     * Stores osu!'s answer for a set, or deletes the set when osu! no longer has it.
     *
     * @param previous The rows served so far, when re-checking.
     */
    private async storeBeatmapset(
        beatmapsetId: number,
        responses: OsuAPIResponse[] | null,
        previous: readonly BeatmapRow[] | null,
    ): Promise<readonly BeatmapRow[] | null> {
        this.beatmapsetCache.delete(beatmapsetId);

        if (responses === null) {
            if (previous) {
                await this.drop(beatmapsetId, previous);
            }

            return null;
        }

        const checkedAt = new Date();
        const rows = responses
            .filter((response) => response.mode === "0")
            .map((response) => convertApiResponseToRow(response, checkedAt))
            .sort(byBeatmapId);

        try {
            const before =
                previous ??
                (await this.beatmapRepository.findByBeatmapsetId(beatmapsetId));
            const removed = new Set(
                await this.beatmapsetRepository.replaceBeatmapset(
                    beatmapsetId,
                    rows,
                    checkedAt,
                ),
            );
            const fresh = new Map(
                rows.map((row) => [row.beatmapId, row.fileMd5]),
            );
            // Files of removed beatmaps, and of beatmaps whose file changed, are stale.
            const stale = before.filter(
                (row) =>
                    removed.has(row.beatmapId) ||
                    (fresh.has(row.beatmapId) &&
                        fresh.get(row.beatmapId) !== row.fileMd5),
            );

            for (const row of stale) {
                this.beatmapService.evictBeatmap(row);
                await this.beatmapFileStore.delete(row.beatmapId);
            }
        } catch (e) {
            console.error(
                `Failed to store beatmapset ${beatmapsetId.toString()}:`,
                getErrorMessage(e),
            );
        }

        const entry = {
            rows: this.beatmapService.cacheBeatmaps(rows),
            lastChecked: checkedAt,
        };

        this.beatmapsetCache.set(beatmapsetId, entry);

        return entry.rows;
    }

    private async drop(
        beatmapsetId: number,
        previous: readonly BeatmapRow[],
    ): Promise<void> {
        for (const row of previous) {
            this.beatmapService.evictBeatmap(row);
        }

        try {
            for (const id of await this.beatmapsetRepository.deleteBeatmapset(
                beatmapsetId,
            )) {
                await this.beatmapFileStore.delete(id);
            }
        } catch (e) {
            console.error(
                `Failed to delete beatmapset ${beatmapsetId.toString()}:`,
                getErrorMessage(e),
            );
        }
    }

    private needsRecheck(set: CachedSet): boolean {
        return isRecheckDue(
            set.lastChecked,
            getBeatmapsetRecheckIntervalMs(
                set.rows.map((row) => row.approved),
                this.config.recheckMinutes,
            ),
        );
    }
}
