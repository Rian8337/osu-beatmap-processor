import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { GoldenCase, GoldenResponse } from "./cases";

export const recordedResponses = JSON.parse(
    await readFile(
        fileURLToPath(new URL("./responses.json", import.meta.url)),
        "utf8",
    ),
) as GoldenResponse[];

const json = { "content-type": "application/json; charset=utf-8" };

const error = (status: number, message: string) => ({
    status,
    headers: json,
    body: { error: message },
});

function findRecordedResponse(name: string): GoldenResponse {
    const response = recordedResponses.find((r) => r.name === name);

    if (!response) {
        throw new Error(`No recorded response named ${name}`);
    }

    return response;
}

/**
 * What the rewrite answers instead, for the cases with a `changeReason`.
 */
const changedAnswers: Record<string, () => Omit<GoldenResponse, "name">> = {
    "getbeatmapfile not found": () => error(404, "Beatmap not found"),
    "getbeatmapfile of a taiko beatmap": () => error(404, "Beatmap not found"),
    "getbeatmap without parameters": () => error(400, "Missing id or hash"),
    "getbeatmapfile without parameters": () => error(400, "Missing id or hash"),
    "getbeatmaps without parameters": () => error(400, "Missing id"),
    "no key": () => {
        const { status, headers, body } =
            findRecordedResponse("getbeatmap by id");

        return { status, headers, body };
    },
};

/**
 * The response the rewrite must give: the recorded one, or the listed change.
 */
export function buildExpectedResponse(
    golden: GoldenCase,
): Omit<GoldenResponse, "name"> {
    if (golden.changeReason) {
        const answer = changedAnswers[golden.name];

        if (!answer) {
            throw new Error(
                `No expected answer for the changed case ${golden.name}`,
            );
        }

        return answer();
    }

    const { status, headers, body } = findRecordedResponse(golden.name);

    return { status, headers, body };
}

/**
 * The parts of a response the contract compares.
 */
export function normalizeResponse(
    status: number,
    header: (name: string) => string | undefined,
    text: string,
): Omit<GoldenResponse, "name"> {
    const headers: Record<string, string> = {};

    for (const name of ["content-type", "content-disposition", "retry-after"]) {
        const value = header(name);

        if (value !== undefined) {
            headers[name] = value;
        }
    }

    return {
        status,
        headers,
        body: headers["content-type"]?.startsWith("application/json")
            ? (JSON.parse(text) as unknown)
            : text,
    };
}
