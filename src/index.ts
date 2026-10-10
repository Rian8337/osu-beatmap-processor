import { config } from "dotenv";
import express, { Router } from "express";
import cors from "cors";
import { ConfigError, getConfig } from "./config.js";
import getBeatmap from "./routes/getbeatmap.js";
import getBeatmapFile from "./routes/getbeatmapfile.js";
import getBeatmaps from "./routes/getbeatmaps.js";
import { osuUnavailableHandler } from "./utils/errorHandler.js";

config();

try {
    // Fail fast on invalid rate limit settings instead of on the first request.
    getConfig();
} catch (e) {
    console.error(e instanceof ConfigError ? e.message : e);
    process.exit(1);
}

const baseRouter = Router()
    .use("/getbeatmap", getBeatmap)
    .use("/getbeatmapfile", getBeatmapFile)
    .use("/getbeatmaps", getBeatmaps);

const app = express()
    .use(cors())
    .use("/api/beatmap", baseRouter)
    .use(osuUnavailableHandler);

const port = parseInt(process.env.EXPRESS_PORT ?? "3000");

app.listen(port, () => {
    console.log(`Server is running on port ${port.toString()}`);
});
