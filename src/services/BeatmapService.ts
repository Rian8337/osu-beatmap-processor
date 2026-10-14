import { convertApiResponseToRow } from "@/beatmaps/converter";
import { keepStoredMaxCombo } from "@/beatmaps/maxCombo";
import { isRecheckDue, getRecheckIntervalMs } from "@/beatmaps/recheck";
import type { BeatmapReference } from "@/beatmaps/validation";
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
import { inject } from "tsyringe";
import { cacheLifetimeMs } from "./cacheLifetime";
import type { IBeatmapService } from "./IBeatmapService";

@Injectable(dependencyTokens.beatmapService)
export class BeatmapService implements IBeatmapService {
    private readonly beatmapsById: LruCache<number, BeatmapRow>;
    private readonly beatmapsByHash: LruCache<string, BeatmapRow>;
    private readonly pendingLookups = new InFlight<string, BeatmapRow | null>();

    constructor(
        @inject(dependencyTokens.config)
        private readonly config: Pick<Config, "cacheSize" | "recheckMinutes">,
        @inject(dependencyTokens.beatmapRepository)
        private readonly beatmapRepository: IBeatmapRepository,
        @inject(dependencyTokens.beatmapsetRepository)
        private readonly beatmapsetRepository: Pick<
            IBeatmapsetRepository,
            "markIncomplete"
        >,
        @inject(dependencyTokens.beatmapFileStore)
        private readonly beatmapFileStore: Pick<IBeatmapFileStore, "delete">,
        @inject(dependencyTokens.osuGateway)
        private readonly osuGateway: Pick<
            IOsuGateway,
            "getBeatmap" | "tryGetBeatmapNow"
        >,
    ) {
        this.beatmapsById = new LruCache(
            config.cacheSize.beatmaps,
            cacheLifetimeMs,
        );
        this.beatmapsByHash = new LruCache(
            config.cacheSize.beatmaps,
            cacheLifetimeMs,
        );
    }

    getBeatmap(
        lane: Lane,
        reference: BeatmapReference,
    ): Promise<BeatmapRow | null> {
        const key =
            "id" in reference
                ? `id:${reference.id.toString()}`
                : `hash:${reference.hash}`;

        // Shared regardless of lane: a second caller waits for the first instead of spending budget.
        return this.pendingLookups.run(key, () => this.lookup(lane, reference));
    }

    async refreshBeatmap(
        lane: Lane,
        beatmapId: number,
    ): Promise<BeatmapRow | null> {
        const fetched = await this.fetch(lane, beatmapId);

        if (!fetched) {
            const known =
                this.beatmapsById.get(beatmapId) ??
                (await this.findStoredBeatmap(beatmapId));

            if (known) {
                await this.removeBeatmap(known);
            }
        }

        return fetched;
    }

    async setMaxCombo(beatmapId: number, maxCombo: number): Promise<void> {
        const cached = this.beatmapsById.get(beatmapId);

        if (cached) {
            this.cacheBeatmaps([{ ...cached, maxCombo }]);
        }

        await this.write(
            `store the max combo of beatmap ${beatmapId.toString()}`,
            () => this.beatmapRepository.update(beatmapId, { maxCombo }),
        );
    }

    cacheBeatmaps(rows: readonly BeatmapRow[]): readonly BeatmapRow[] {
        return rows.map((row) => {
            const frozen = Object.isFrozen(row)
                ? row
                : Object.freeze({ ...row });

            this.beatmapsById.set(frozen.beatmapId, frozen);
            this.beatmapsByHash.set(frozen.fileMd5, frozen);

            return frozen;
        });
    }

    evictBeatmap(row: Pick<BeatmapRow, "beatmapId" | "fileMd5">): void {
        this.beatmapsById.delete(row.beatmapId);
        this.beatmapsByHash.delete(row.fileMd5);
    }

    private async lookup(
        lane: Lane,
        reference: BeatmapReference,
    ): Promise<BeatmapRow | null> {
        // A failed database read throws DatabaseUnavailableError here, before osu! is asked.
        const remembered =
            "id" in reference
                ? this.beatmapsById.get(reference.id)
                : this.beatmapsByHash.get(reference.hash);
        const cached =
            remembered ??
            ("id" in reference
                ? await this.beatmapRepository.findById(reference.id)
                : await this.beatmapRepository.findByHash(reference.hash));

        if (!cached) {
            return this.fetch(
                lane,
                "id" in reference ? reference.id : reference.hash,
            );
        }

        const current = this.needsRecheck(cached)
            ? await this.recheck(lane, cached)
            : cached;

        if (!current) {
            return null;
        }

        // A memory hit that was not re-checked keeps its original expiry.
        if (current === remembered) {
            return current;
        }

        return this.cacheBeatmaps([current])[0] ?? null;
    }

    private async fetch(
        lane: Lane,
        idOrHash: number | string,
    ): Promise<BeatmapRow | null> {
        const response = await this.osuGateway.getBeatmap(lane, idOrHash);

        if (!response) {
            return null;
        }

        const row = convertApiResponseToRow(response);
        const previous =
            this.beatmapsById.get(row.beatmapId) ??
            (await this.findStoredBeatmap(row.beatmapId));

        if (previous && previous.fileMd5 !== row.fileMd5) {
            await this.invalidateBeatmap(previous);
        }

        await this.write(`store beatmap ${row.beatmapId.toString()}`, () =>
            this.beatmapRepository.upsert([row]),
        );

        return this.cacheBeatmaps([row])[0] ?? null;
    }

    /**
     * The stored beatmap, or `null` if there is none or the database cannot be read (the failure is logged).
     */
    private async findStoredBeatmap(
        beatmapId: number,
    ): Promise<BeatmapRow | null> {
        try {
            return await this.beatmapRepository.findById(beatmapId);
        } catch (e) {
            console.error(
                `Failed to read the stored beatmap ${beatmapId.toString()}:`,
                getErrorMessage(e),
            );

            return null;
        }
    }

    /**
     * The optional status re-check. It never fails a lookup: when the limiter is busy or osu! is unavailable, the
     * cached beatmap is served unchanged.
     */
    private async recheck(
        lane: Lane,
        cached: BeatmapRow,
    ): Promise<BeatmapRow | null> {
        let response;

        try {
            response = await this.osuGateway.tryGetBeatmapNow(
                lane,
                cached.beatmapId,
            );
        } catch (e) {
            if (e instanceof OsuUnavailableError) {
                return cached;
            }

            throw e;
        }

        if (response === undefined) {
            return cached;
        }

        if (response === null) {
            await this.removeBeatmap(cached);

            return null;
        }

        const fresh = convertApiResponseToRow(response);

        if (fresh.fileMd5 !== cached.fileMd5) {
            await this.invalidateBeatmap(cached);
            await this.write(
                `store beatmap ${fresh.beatmapId.toString()}`,
                () => this.beatmapRepository.upsert([fresh]),
            );

            return fresh;
        }

        // Every column comes from osu!'s answer (this is how rows with UTC+8 dates heal), except a max combo that
        // osu! does not know and the file provided.
        const updated = keepStoredMaxCombo(fresh, cached);

        await this.write(`update beatmap ${fresh.beatmapId.toString()}`, () =>
            this.beatmapRepository.upsert([updated]),
        );

        return updated;
    }

    /**
     * Drops what is cached about a beatmap whose file changed: memory, its file, and its set's completeness.
     */
    private async invalidateBeatmap(previous: BeatmapRow): Promise<void> {
        const id = previous.beatmapId.toString();

        this.evictBeatmap(previous);
        await this.write(`delete the file of beatmap ${id}`, () =>
            this.beatmapFileStore.delete(previous.beatmapId),
        );
        await this.write(
            `mark beatmapset ${previous.beatmapsetId.toString()} incomplete`,
            () =>
                this.beatmapsetRepository.markIncomplete(previous.beatmapsetId),
        );
    }

    private async removeBeatmap(row: BeatmapRow): Promise<void> {
        await this.invalidateBeatmap(row);
        await this.write(`delete beatmap ${row.beatmapId.toString()}`, () =>
            this.beatmapRepository.delete(row.beatmapId),
        );
    }

    private needsRecheck(row: BeatmapRow): boolean {
        return isRecheckDue(
            row.lastChecked,
            getRecheckIntervalMs(row.approved, this.config.recheckMinutes),
        );
    }

    /**
     * Runs a write. A failed write is logged; the request is still served from the data in hand.
     */
    private async write(
        what: string,
        action: () => Promise<unknown>,
    ): Promise<void> {
        try {
            await action();
        } catch (e) {
            console.error(`Failed to ${what}:`, getErrorMessage(e));
        }
    }
}
