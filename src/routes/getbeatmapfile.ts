import { Router } from "express";
import asyncHandler from "express-async-handler";
import { getBeatmapFile } from "../utils/beatmap/beatmapStorage";

const router = Router();

router.get<"/", unknown, { error?: string }, unknown, Partial<{ id: string }>>(
    "/",
    asyncHandler(async (req, res) => {
        const { id } = req.query;

        if (!id) {
            return void res.status(400).json({
                error: "Missing id query parameter",
            });
        }

        const beatmapFile = await getBeatmapFile(parseInt(id));

        if (!beatmapFile) {
            return void res.status(404).json({
                error: "Beatmap file not found",
            });
        }

        res.download(beatmapFile, `${id}.osu`);
    }),
);

export default router;
