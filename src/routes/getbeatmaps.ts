import { Router } from "express";
import { OsuAPIResponse } from "@rian8337/osu-base";
import asyncHandler from "express-async-handler";
import { getBeatmapset } from "../utils/beatmap/beatmapStorage";
import { convertDatabaseBeatmapToOsuAPIResponse } from "../utils/beatmap/beatmapConverter";
import { validateGETInternalKey } from "../utils/security";

const router = Router();

router.get<
    "/",
    unknown,
    { error?: string } | OsuAPIResponse[],
    unknown,
    Partial<{ key: string; id: string }>
>(
    "/",
    validateGETInternalKey,
    asyncHandler(async (req, res) => {
        const { id } = req.query;

        if (!id) {
            return void res.status(400).json({
                error: "Missing id or hash query parameter",
            });
        }

        const beatmaps = await getBeatmapset(parseInt(id));

        if (!beatmaps) {
            return void res.status(404).json({
                error: "Beatmapset not found",
            });
        }

        const jsonBeatmaps: OsuAPIResponse[] = [];

        for (const beatmap of beatmaps.values()) {
            jsonBeatmaps.push(convertDatabaseBeatmapToOsuAPIResponse(beatmap));
        }

        res.json(jsonBeatmaps);
    }),
);

export default router;
