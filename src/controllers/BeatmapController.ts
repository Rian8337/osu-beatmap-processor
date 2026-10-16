import { getCallerLane } from "@/access/types";
import { convertRowToApiResponse } from "@/beatmaps/converter";
import {
    parseBeatmapReference,
    parseBeatmapsetId,
} from "@/beatmaps/validation";
import { dependencyTokens } from "@/dependencies/tokens";
import { getCaller } from "@/http/requestContext";
import { OsuUnavailableError } from "@/osu/errors";
import { BaseController, Controller, Get } from "@/server";
import type { IBeatmapFileService } from "@/services/IBeatmapFileService";
import type { IBeatmapService } from "@/services/IBeatmapService";
import type { IBeatmapsetService } from "@/services/IBeatmapsetService";
import type { OsuAPIResponse } from "@rian8337/osu-base";
import type { Request, Response } from "express";
import { inject } from "tsyringe";

type ErrorBody = { error: string };

/**
 * The pre-rewrite routes, mounted at `/api/beatmap`. A `404` with `{ error }` means only that osu! has no such
 * beatmap, set, or file: the dpp processors rely on it.
 */
@Controller("")
export class BeatmapController extends BaseController {
    constructor(
        @inject(dependencyTokens.beatmapService)
        private readonly beatmapService: Pick<IBeatmapService, "getBeatmap">,
        @inject(dependencyTokens.beatmapsetService)
        private readonly beatmapsetService: IBeatmapsetService,
        @inject(dependencyTokens.beatmapFileService)
        private readonly beatmapFileService: IBeatmapFileService,
    ) {
        super();
    }

    @Get("/getbeatmap")
    async getBeatmap(
        req: Request,
        res: Response<OsuAPIResponse | ErrorBody>,
    ): Promise<void> {
        try {
            const beatmap = await this.beatmapService.getBeatmap(
                getCallerLane(getCaller(res)),
                parseBeatmapReference(req.query),
            );

            if (!beatmap) {
                res.status(404).json({ error: "Beatmap not found" });

                return;
            }

            res.json(convertRowToApiResponse(beatmap));
        } catch (e) {
            this.handleError(res, e);
        }
    }

    @Get("/getbeatmapfile")
    async getBeatmapFile(req: Request, res: Response): Promise<void> {
        try {
            const lane = getCallerLane(getCaller(res));
            // Metadata first, so that every served file is checked against its MD5 and is osu!standard.
            const beatmap = await this.beatmapService.getBeatmap(
                lane,
                parseBeatmapReference(req.query),
            );

            if (!beatmap) {
                res.status(404).json({ error: "Beatmap not found" });

                return;
            }

            const file = await this.beatmapFileService.getBeatmapFile(
                lane,
                beatmap,
            );

            if (!file) {
                res.status(404).json({ error: "Beatmap file not found" });

                return;
            }

            res.setHeader(
                "Content-Disposition",
                `attachment; filename=${beatmap.beatmapId.toString()}.osu`,
            );
            res.setHeader("Content-Type", "text/plain");
            res.end(file);

            this.beatmapFileService.backfillMaxCombo(beatmap, file);
        } catch (e) {
            this.handleError(res, e);
        }
    }

    @Get("/getbeatmaps")
    async getBeatmaps(
        req: Request,
        res: Response<OsuAPIResponse[] | ErrorBody>,
    ): Promise<void> {
        try {
            const set = await this.beatmapsetService.getBeatmapset(
                getCallerLane(getCaller(res)),
                parseBeatmapsetId(req.query),
            );

            if (!set) {
                res.status(404).json({ error: "Beatmapset not found" });

                return;
            }

            res.json(set.map(convertRowToApiResponse));
        } catch (e) {
            this.handleError(res, e);
        }
    }

    protected override handleError(res: Response, error: unknown): void {
        if (error instanceof OsuUnavailableError) {
            res.status(503)
                .set("Retry-After", error.retryAfterSeconds.toString())
                .json({ error: error.message });

            return;
        }

        super.handleError(res, error);
    }
}
