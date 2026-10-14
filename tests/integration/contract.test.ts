import { bulkKey, goldenCases, priorityKey } from "@test/golden/cases";
import {
    normalizeResponse,
    buildExpectedResponse,
    recordedResponses,
} from "@test/golden/expected";
import { startTestApp } from "@test/utils/app";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

describe("the HTTP contract", () => {
    it("answers every recorded request as the pre-rewrite service did, except the listed changes", async () => {
        await using test = await startTestApp({
            config: { builtInKeys: { priority: priorityKey, bulk: bulkKey } },
        });

        expect(recordedResponses.map((r) => r.name)).toEqual(
            goldenCases.map((c) => c.name),
        );

        for (const golden of goldenCases) {
            test.osuState.rateLimited = golden.rateLimited ?? false;

            const response = await request(test.app).get(golden.path);

            expect({
                name: golden.name,
                ...normalizeResponse(
                    response.status,
                    (name) => response.headers[name] as string | undefined,
                    response.text,
                ),
            }).toEqual({
                name: golden.name,
                ...buildExpectedResponse(golden),
            });
        }
    });
});
