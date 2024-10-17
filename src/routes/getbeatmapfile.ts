import { Router } from "express";
import asyncHandler from "express-async-handler";
import { getBeatmap, getBeatmapFile } from "../utils/beatmap/beatmapStorage";
import { validateGETInternalKey } from "../utils/security";

const router = Router();

router.get<
    "/",
    unknown,
    { error?: string },
    unknown,
    Partial<{ key: string; id: string; hash: string }>
>(
    "/",
    validateGETInternalKey,
    asyncHandler(async (req, res) => {
        const { id, hash } = req.query;

        if (!id && !hash) {
            return void res.status(400).json({
                error: "Missing id query parameter",
            });
        }

        let beatmapId: number;

        if (id) {
            beatmapId = parseInt(id);
        } else {
            const beatmap = await getBeatmap(hash!);

            if (!beatmap) {
                return void res.status(404).json({
                    error: "Beatmap not found",
                });
            }

            beatmapId = beatmap.beatmap_id;
        }

        const beatmapFile = await getBeatmapFile(beatmapId);

        if (!beatmapFile) {
            return void res.status(404).json({
                error: "Beatmap file not found",
            });
        }

        res.download(beatmapFile, `${beatmapId.toString()}.osu`);
    }),
);

export default router;
