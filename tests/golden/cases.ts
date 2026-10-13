// Run directly by Node in scripts/record-golden.ts: erasable syntax only.
import { computeFixtureMD5, buildOsuFile } from "../fixtures/osu/beatmaps.ts";

export interface GoldenCase {
    readonly name: string;
    /** Path and query, relative to the server. */
    readonly path: string;
    /** Make osu! answer 429 before this request. */
    readonly rateLimited?: boolean;
    /** Why the rewrite answers differently; the contract test checks the new answer explicitly. */
    readonly changeReason?: string;
}

export interface GoldenResponse {
    readonly name: string;
    readonly status: number;
    /** Only `content-type`, `content-disposition`, and `retry-after`, when present. */
    readonly headers: Record<string, string>;
    /** Parsed JSON for JSON responses, otherwise the text. */
    readonly body: unknown;
}

export const priorityKey = "golden-priority-key";
export const bulkKey = "golden-bulk-key";

const hash75 = computeFixtureMD5(buildOsuFile(75, "Normal"));

/**
 * Run in this order: earlier requests fill the caches later ones rely on, and the rate-limited case comes last.
 */
export const goldenCases: readonly GoldenCase[] = [
    { name: "getbeatmap by id", path: `/api/beatmap/getbeatmap?id=75&key=${priorityKey}` },
    { name: "getbeatmap by hash", path: `/api/beatmap/getbeatmap?hash=${hash75}&key=${bulkKey}` },
    { name: "getbeatmap not found", path: `/api/beatmap/getbeatmap?id=999&key=${priorityKey}` },
    { name: "getbeatmapfile by id", path: `/api/beatmap/getbeatmapfile?id=75&key=${priorityKey}` },
    { name: "getbeatmapfile by hash", path: `/api/beatmap/getbeatmapfile?hash=${hash75}&key=${priorityKey}` },
    { name: "getbeatmapfile without a file", path: `/api/beatmap/getbeatmapfile?id=76&key=${priorityKey}` },
    {
        name: "getbeatmapfile not found",
        path: `/api/beatmap/getbeatmapfile?id=999&key=${priorityKey}`,
        changeReason: "metadata is resolved first, so an unknown beatmap is 404 Beatmap not found",
    },
    {
        name: "getbeatmapfile of a taiko beatmap",
        path: `/api/beatmap/getbeatmapfile?id=1001&key=${priorityKey}`,
        changeReason: "metadata is resolved first, so a non-standard beatmap is 404 Beatmap not found",
    },
    { name: "getbeatmaps", path: `/api/beatmap/getbeatmaps?id=1&key=${priorityKey}` },
    { name: "getbeatmaps not found", path: `/api/beatmap/getbeatmaps?id=999&key=${priorityKey}` },
    { name: "wrong key", path: "/api/beatmap/getbeatmap?id=75&key=wrong" },
    {
        name: "getbeatmap without parameters",
        path: `/api/beatmap/getbeatmap?key=${priorityKey}`,
        changeReason: "message is Missing id or hash",
    },
    {
        name: "getbeatmapfile without parameters",
        path: `/api/beatmap/getbeatmapfile?key=${priorityKey}`,
        changeReason: "message is Missing id or hash",
    },
    {
        name: "getbeatmaps without parameters",
        path: `/api/beatmap/getbeatmaps?key=${priorityKey}`,
        changeReason: "message is Missing id",
    },
    {
        name: "no key",
        path: "/api/beatmap/getbeatmap?id=75",
        changeReason: "requests without a key are anonymous (bulk lane, limited per IP)",
    },
    {
        name: "osu! rate limited",
        path: `/api/beatmap/getbeatmap?id=77&key=${priorityKey}`,
        rateLimited: true,
    },
];
