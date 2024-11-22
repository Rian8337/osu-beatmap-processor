import { Router } from "express";
import asyncHandler from "express-async-handler";
import {
    getBeatmap,
    getBeatmapFile,
    getBeatmapFromDatabase,
    updateBeatmapMaxCombo,
} from "../utils/beatmap/beatmapStorage";
import { validateGETInternalKey } from "../utils/security";
import { DatabaseBeatmap } from "../database/schema/DatabaseBeatmap";
import { BeatmapDecoder } from "@rian8337/osu-base";
import { PassThrough } from "stream";

const router = Router();

router.get<
    "/",
    unknown,
    { error?: string } | Buffer,
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

        let beatmap: DatabaseBeatmap | null = null;
        let beatmapId: number;

        if (id) {
            beatmapId = parseInt(id);
        } else {
            beatmap = await getBeatmap(hash!);

            if (!beatmap) {
                return void res.status(404).json({
                    error: "Beatmap not found",
                });
            }

            beatmapId = beatmap.beatmap_id;
        }

        const beatmapFile = await getBeatmapFile(beatmapId, beatmap?.file_md5);

        if (!beatmapFile) {
            return void res.status(404).json({
                error: "Beatmap file not found",
            });
        }

        const readStream = new PassThrough();
        readStream.end(beatmapFile);

        res.setHeader(
            "Content-Disposition",
            "attachment; filename=" + `${beatmapId.toString()}.osu`,
        );
        res.setHeader("Content-Type", "text/plain");

        readStream.pipe(res);

        // Attempt to update max combo in case osu! API returned a null max combo.
        beatmap ??= await getBeatmapFromDatabase(beatmapId);

        if (beatmap && beatmap.max_combo === null) {
            const parsedBeatmap = new BeatmapDecoder().decode(
                beatmapFile.toString(),
            ).result;

            await updateBeatmapMaxCombo(beatmapId, parsedBeatmap.maxCombo);
        }
    }),
);

export default router;
