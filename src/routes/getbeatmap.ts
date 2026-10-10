import { Router } from "express";
import asyncHandler from "express-async-handler";
import { getBeatmap } from "../utils/beatmap/beatmapStorage.js";
import { convertDatabaseBeatmapToOsuAPIResponse } from "../utils/beatmap/beatmapConverter.js";
import { OsuAPIResponse } from "@rian8337/osu-base";
import { validateGETInternalKey } from "../utils/security.js";
import { getLane } from "../utils/lane.js";

const router = Router();

router.get<
    "/",
    unknown,
    { error?: string } | OsuAPIResponse,
    unknown,
    Partial<{ key: string; id: string; hash: string }>
>(
    "/",
    validateGETInternalKey,
    asyncHandler(async (req, res) => {
        const { id, hash } = req.query;

        if (!id && !hash) {
            return void res.status(400).json({
                error: "Missing id or hash query parameter",
            });
        }

        const beatmap = await getBeatmap(
            getLane(res),
            id !== undefined ? parseInt(id) : hash!,
        );

        if (!beatmap) {
            // If the beatmap is not found, request the osu! API.
            return void res.status(404).json({
                error: "Beatmap not found",
            });
        }

        // Convert the beatmap to an osu! API response.
        res.json(convertDatabaseBeatmapToOsuAPIResponse(beatmap));
    }),
);

export default router;
