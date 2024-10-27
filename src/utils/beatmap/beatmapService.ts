import { OsuAPIRequestBuilder, OsuAPIResponse } from "@rian8337/osu-base";

/**
 * Gets a beatmapset from the osu! API.
 *
 * @param id The beatmapset ID.
 * @returns The beatmapset, `null` if the beatmapset cannot be found.
 */
export function getBeatmapsetFromOsuAPI(
    id: number,
): Promise<OsuAPIResponse[] | null> {
    return new OsuAPIRequestBuilder()
        .setEndpoint("get_beatmaps")
        .addParameter("s", id.toString())
        .sendRequest()
        .then((res) => {
            if (res.statusCode !== 200) {
                return null;
            }

            return JSON.parse(res.data.toString()) as OsuAPIResponse[];
        })
        .catch((e: unknown) => {
            console.error(e);

            return null;
        });
}

/**
 * Downloads a beatmap file from the osu! website.
 *
 * @param id The ID of the beatmap.
 * @returns The beatmap file, `null` if the beatmap file cannot be downloaded.
 */
export function getBeatmapFile(id: number): Promise<Buffer | null> {
    return fetch(`https://osu.ppy.sh/osu/${id.toString()}`)
        .then((res) => {
            if (!res.ok) {
                return null;
            }

            return res.arrayBuffer();
        })
        .then((res) => (res ? Buffer.from(res) : null))
        .catch(() => null);
}
