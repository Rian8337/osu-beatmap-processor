import { BadRequestError } from "@/server";

/**
 * How a request names a beatmap.
 */
export type BeatmapReference = { readonly id: number } | { readonly hash: string };

const maxId = 2_147_483_647;

/**
 * Whether a query value was given. Empty values count as missing, as they did before the rewrite.
 */
function isPresent(value: unknown): boolean {
    return value !== undefined && value !== "";
}

function parseId(value: unknown): number {
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
        throw new BadRequestError("Invalid id");
    }

    const id = Number(value);

    if (id < 1 || id > maxId) {
        throw new BadRequestError("Invalid id");
    }

    return id;
}

/**
 * Reads `id` or `hash` from a query. `id` wins when both are given.
 *
 * @throws {BadRequestError} "Missing id or hash", "Invalid id", or "Invalid hash".
 */
export function parseBeatmapReference(
    query: Record<string, unknown>,
): BeatmapReference {
    if (isPresent(query.id)) {
        return { id: parseId(query.id) };
    }

    if (isPresent(query.hash)) {
        const { hash } = query;

        if (typeof hash !== "string" || !/^[0-9a-f]{32}$/i.test(hash)) {
            throw new BadRequestError("Invalid hash");
        }

        return { hash: hash.toLowerCase() };
    }

    throw new BadRequestError("Missing id or hash");
}

/**
 * Reads a beatmapset `id` from a query.
 *
 * @throws {BadRequestError} "Missing id" or "Invalid id".
 */
export function parseBeatmapsetId(query: Record<string, unknown>): number {
    if (!isPresent(query.id)) {
        throw new BadRequestError("Missing id");
    }

    return parseId(query.id);
}
