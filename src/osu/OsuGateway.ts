import { formatOsuDate } from "@/beatmaps/converter";
import { dependencyTokens } from "@/dependencies/tokens";
import { Injectable } from "@/server";
import type { OsuAPIResponse } from "@rian8337/osu-base";
import { inject } from "tsyringe";
import { OsuUnavailableError, type Lane, type RequestKind } from "./errors";
import type { IOsuGateway } from "./IOsuGateway";
import type { RateLimiter } from "./RateLimiter";

export interface OsuGatewayOptions {
    readonly apiKey: string;
    readonly apiBaseUrl: string;
    readonly fileBaseUrl: string;
    readonly rateLimiter: RateLimiter;

    /**
     * Defaults to 10 000.
     */
    readonly timeoutMs?: number;
}

/**
 * `Retry-After` hint for failures other than osu!'s own `429`.
 */
const failureRetryAfterSeconds = 5;

/**
 * Longest pause honored from a `Retry-After` header (larger values would overflow timers).
 */
const maxRetryAfterSeconds = 3600;

/**
 * Pause after a `429` without a `Retry-After` header.
 */
const defaultRateLimitPauseSeconds = 60;

/**
 * The most beatmaps osu! API v1 returns per `get_beatmaps` call.
 */
export const sincePageSize = 500;

type Outcome<T> =
    | { readonly kind: "ok"; readonly value: T }
    | { readonly kind: "rate-limited"; readonly retryAfterSeconds: number }
    | { readonly kind: "failed"; readonly reason: string };

function redact(url: string): string {
    return url.replace(/([?&]k=)[^&]*/, "$1<redacted>");
}

function parseRetryAfter(header: string | null): number | undefined {
    if (header === null) {
        return undefined;
    }

    const seconds = Number(header);

    return Number.isFinite(seconds) && seconds > 0
        ? Math.min(Math.ceil(seconds), maxRetryAfterSeconds)
        : undefined;
}

function isBeatmapList(body: unknown): body is OsuAPIResponse[] {
    return (
        Array.isArray(body) &&
        body.every(
            (entry) =>
                typeof entry === "object" &&
                entry !== null &&
                "beatmap_id" in entry &&
                "mode" in entry,
        )
    );
}

/**
 * The only code that calls osu!. Each operation is exactly one request through the rate limiter: no retries.
 * Concurrent calls in the same lane for the same thing share one request.
 */
@Injectable(dependencyTokens.osuGateway)
export class OsuGateway implements IOsuGateway {
    private readonly timeoutMs: number;
    private readonly inFlight = new Map<string, Promise<unknown>>();

    constructor(
        @inject(dependencyTokens.osuGatewayOptions)
        private readonly options: OsuGatewayOptions,
    ) {
        this.timeoutMs = options.timeoutMs ?? 10_000;
    }

    async getBeatmap(
        lane: Lane,
        idOrHash: number | string,
    ): Promise<OsuAPIResponse | null> {
        const list = await this.getBeatmapList(
            lane,
            this.beatmapQuery(idOrHash),
        );

        return OsuGateway.firstStandard(list);
    }

    async getBeatmapset(
        lane: Lane,
        id: number,
    ): Promise<OsuAPIResponse[] | null> {
        const list = await this.getBeatmapList(lane, `s=${id.toString()}`);

        return list.length > 0 ? list : null;
    }

    getBeatmapsSince(lane: Lane, since: Date): Promise<OsuAPIResponse[]> {
        return this.getBeatmapList(
            lane,
            `since=${encodeURIComponent(formatOsuDate(since))}&m=0&limit=${sincePageSize.toString()}`,
        );
    }

    downloadFile(lane: Lane, id: number): Promise<Buffer | null> {
        return this.shared(`${lane}:file:${id.toString()}`, () =>
            this.options.rateLimiter.schedule(lane, "file", () =>
                this.requestFile(id),
            ),
        );
    }

    async tryGetBeatmapNow(
        lane: Lane,
        idOrHash: number | string,
    ): Promise<OsuAPIResponse | null | undefined> {
        const query = this.beatmapQuery(idOrHash);
        const list = await this.options.rateLimiter.tryNow(lane, "api", () =>
            this.requestBeatmapList(query),
        );

        return list === undefined ? undefined : OsuGateway.firstStandard(list);
    }

    async tryGetBeatmapsetNow(
        lane: Lane,
        id: number,
    ): Promise<OsuAPIResponse[] | null | undefined> {
        const list = await this.options.rateLimiter.tryNow(lane, "api", () =>
            this.requestBeatmapList(`s=${id.toString()}`),
        );

        if (list === undefined) {
            return undefined;
        }

        return list.length > 0 ? list : null;
    }

    private static firstStandard(
        list: readonly OsuAPIResponse[],
    ): OsuAPIResponse | null {
        const first = list.at(0);

        return first?.mode === "0" ? first : null;
    }

    private beatmapQuery(idOrHash: number | string): string {
        return typeof idOrHash === "number"
            ? `b=${idOrHash.toString()}`
            : `h=${encodeURIComponent(idOrHash)}`;
    }

    private getBeatmapList(
        lane: Lane,
        query: string,
    ): Promise<OsuAPIResponse[]> {
        return this.shared(`${lane}:api:${query}`, () =>
            this.options.rateLimiter.schedule(lane, "api", () =>
                this.requestBeatmapList(query),
            ),
        );
    }

    private async requestBeatmapList(query: string): Promise<OsuAPIResponse[]> {
        const url = `${this.options.apiBaseUrl}/get_beatmaps?k=${this.options.apiKey}&${query}`;
        const outcome = await this.request(url, async (response) => {
            if (response.status !== 200) {
                return undefined;
            }

            const body: unknown = await response.json();

            return isBeatmapList(body) ? body : undefined;
        });

        return this.unwrap(url, outcome);
    }

    private async requestFile(id: number): Promise<Buffer | null> {
        const url = `${this.options.fileBaseUrl}/${id.toString()}`;
        const outcome = await this.request(url, async (response) => {
            if (response.status === 404) {
                await response.body?.cancel();

                return null;
            }

            if (response.status !== 200) {
                return undefined;
            }

            const bytes = Buffer.from(await response.arrayBuffer());

            return bytes.length > 0 ? bytes : null;
        });

        return this.unwrap(url, outcome);
    }

    /**
     * Sends one request. `read` returns the value, or `undefined` for an unusable response.
     */
    private async request<T>(
        url: string,
        read: (response: Response) => Promise<T | undefined>,
    ): Promise<Outcome<T>> {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(this.timeoutMs),
            });

            if (response.status === 429) {
                await response.body?.cancel();

                return {
                    kind: "rate-limited",
                    retryAfterSeconds:
                        parseRetryAfter(response.headers.get("retry-after")) ??
                        defaultRateLimitPauseSeconds,
                };
            }

            const value = await read(response);

            return value === undefined
                ? {
                      kind: "failed",
                      reason: `unusable response with status ${response.status.toString()}`,
                  }
                : { kind: "ok", value };
        } catch (e) {
            return {
                kind: "failed",
                reason: e instanceof Error ? e.message : String(e),
            };
        }
    }

    private unwrap<T>(url: string, outcome: Outcome<T>): T {
        switch (outcome.kind) {
            case "ok":
                return outcome.value;
            case "rate-limited":
                console.warn(
                    `osu! rate limited ${redact(url)}; pausing all requests for ${outcome.retryAfterSeconds.toString()} s`,
                );
                this.options.rateLimiter.pauseFor(
                    outcome.retryAfterSeconds * 1000,
                );

                throw new OsuUnavailableError(outcome.retryAfterSeconds);
            case "failed":
                console.error(
                    `osu! request ${redact(url)} failed: ${outcome.reason}`,
                );

                throw new OsuUnavailableError(failureRetryAfterSeconds);
        }
    }

    private shared<T>(key: string, start: () => Promise<T>): Promise<T> {
        const existing = this.inFlight.get(key);

        if (existing) {
            // Every entry under this key was stored by this method with the same T.
            return existing as Promise<T>;
        }

        let promise: Promise<T>;

        try {
            promise = start();
        } catch (e) {
            return Promise.reject(
                e instanceof Error ? e : new Error(String(e)),
            );
        }

        this.inFlight.set(key, promise);
        void promise
            // The caller handles a rejection; this copy only waits for the promise to settle.
            .catch(() => undefined)
            .finally(() => this.inFlight.delete(key));

        return promise;
    }
}

export type { RequestKind };
