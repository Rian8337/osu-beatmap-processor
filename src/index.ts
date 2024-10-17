import { config } from "dotenv";
import express from "express";
import cors from "cors";
import getBeatmap from "./routes/getbeatmap";
import getBeatmapFile from "./routes/getbeatmapfile";
import getBeatmaps from "./routes/getbeatmaps";

config();

const app = express()
    .use(cors())
    .use("/getbeatmap", getBeatmap)
    .use("/getbeatmapfile", getBeatmapFile)
    .use("/getbeatmaps", getBeatmaps);

const port = parseInt(process.env.EXPRESS_PORT ?? "3000");

app.listen(port, () => {
    console.log(`Server is running on port ${port.toString()}`);
});
