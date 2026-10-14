// Checks the osu! API v1 behaviour the rewrite relies on (Task 18 of the rewrite plan). Makes three requests to
// osu!. Run with: node --env-file=.env scripts/check-osu-api.ts
import { createHash } from "node:crypto";

interface Entry {
    readonly beatmap_id: string;
    readonly approved_date: string | null;
    readonly mode: string;
    readonly file_md5: string;
}

const key = process.env.OSU_API_KEY;

if (!key) {
    throw new Error("OSU_API_KEY is not set");
}

const api = "https://osu.ppy.sh/api/get_beatmaps";
const since = "2007-10-01 00:00:00";
const page = (await (
    await fetch(
        `${api}?k=${key}&since=${encodeURIComponent(since)}&m=0&limit=5`,
    )
).json()) as Entry[];

console.log(
    "since page:",
    page.map(
        (b) => `${b.beatmap_id} ${b.approved_date ?? "null"} mode ${b.mode}`,
    ),
);
console.log(
    "ordered by approval date:",
    page.every(
        (b, i) =>
            i === 0 ||
            (page[i - 1]?.approved_date ?? "") <= (b.approved_date ?? ""),
    ),
);
console.log(
    "all approved on or after since:",
    page.every((b) => (b.approved_date ?? "") >= since),
);
console.log(
    "all osu!standard:",
    page.every((b) => b.mode === "0"),
);

const [meta] = (await (await fetch(`${api}?k=${key}&b=75`)).json()) as Entry[];
const file = Buffer.from(
    await (await fetch("https://osu.ppy.sh/osu/75")).arrayBuffer(),
);
const hash = createHash("md5").update(file).digest("hex");

console.log(
    `beatmap 75: file_md5 ${meta?.file_md5 ?? "missing"}, downloaded ${hash}, match: ${String(meta?.file_md5 === hash)}`,
);
