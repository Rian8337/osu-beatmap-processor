import { config } from "dotenv";
import express, { Router } from "express";
import cors from "cors";
import getBeatmap from "./routes/getbeatmap";
import getBeatmapFile from "./routes/getbeatmapfile";
import getBeatmaps from "./routes/getbeatmaps";
import { OsuAPIRequestBuilder } from "@rian8337/osu-base";

config();

OsuAPIRequestBuilder.setAPIKey(process.env.OSU_API_KEY!);

const baseRouter = Router()
    .use("/getbeatmap", getBeatmap)
    .use("/getbeatmapfile", getBeatmapFile)
    .use("/getbeatmaps", getBeatmaps);

const app = express().use(cors()).use("/api/beatmap", baseRouter);

const port = parseInt(process.env.EXPRESS_PORT ?? "3000");

app.listen(port, () => {
    console.log(`Server is running on port ${port.toString()}`);
});
