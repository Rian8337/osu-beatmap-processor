// Run directly by Node in scripts/record-golden.ts: erasable syntax only.
import type { OsuAPIResponse } from "@rian8337/osu-base";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface FakeOsuState {
    beatmaps: OsuAPIResponse[];
    files: Map<number, Buffer>;
    /** Answer every request with 429 and `Retry-After: 30`. */
    rateLimited: boolean;
}

/**
 * Serves `GET /api/get_beatmaps` (`b`, `h`, `s`, or `since` with `m` and `limit`) and `GET /osu/<id>` from `state`.
 * `since` is inclusive and orders by approval date, then beatmap ID.
 */
export function createFakeOsuHandler(
    state: FakeOsuState,
): (req: IncomingMessage, res: ServerResponse) => void {
    return (req, res) => {
        const url = new URL(req.url ?? "", "http://fake-osu");

        if (state.rateLimited) {
            res.writeHead(429, { "Retry-After": "30" }).end();
            return;
        }

        if (url.pathname === "/api/get_beatmaps") {
            const params = url.searchParams;
            let list = state.beatmaps;
            const id = params.get("b");
            const hash = params.get("h");
            const set = params.get("s");
            const since = params.get("since");

            if (id !== null) {
                list = list.filter((b) => b.beatmap_id === id);
            }

            if (hash !== null) {
                list = list.filter((b) => b.file_md5 === hash);
            }

            if (set !== null) {
                list = list.filter((b) => b.beatmapset_id === set);
            }

            if (since !== null) {
                const mode = params.get("m");

                list = list
                    .filter(
                        (b) =>
                            b.approved_date !== null &&
                            b.approved_date >= since &&
                            (mode === null || b.mode === mode),
                    )
                    .sort(
                        (a, b) =>
                            (a.approved_date ?? "").localeCompare(
                                b.approved_date ?? "",
                            ) || Number(a.beatmap_id) - Number(b.beatmap_id),
                    )
                    .slice(0, Number(params.get("limit") ?? "500"));
            }

            res.writeHead(200, { "Content-Type": "application/json" }).end(
                JSON.stringify(list),
            );
            return;
        }

        const file = /^\/osu\/(\d+)$/.exec(url.pathname);

        if (file) {
            const data = state.files.get(Number(file[1]));

            if (data) {
                res.writeHead(200, { "Content-Type": "text/plain" }).end(data);
            } else {
                res.writeHead(404).end();
            }

            return;
        }

        res.writeHead(404).end();
    };
}
