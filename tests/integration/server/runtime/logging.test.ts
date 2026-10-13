import { installLogPrefix } from "@/server/runtime/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("installLogPrefix", () => {
    const original = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
    };
    let calls: unknown[][];

    beforeEach(() => {
        calls = [];

        for (const method of ["log", "info", "warn", "error"] as const) {
            console[method] = vi.fn((...args: unknown[]) => calls.push(args));
        }
    });

    afterEach(() => {
        Object.assign(console, original);
    });

    it("prefixes every console method with the variant ID until disposed", () => {
        {
            using _prefix = installLogPrefix("droid-live");

            console.log("a");
            console.info("b", 1);
            console.warn("c");
            console.error("d");
        }

        console.log("after");

        expect(calls).toEqual([
            ["[droid-live]", "a"],
            ["[droid-live]", "b", 1],
            ["[droid-live]", "c"],
            ["[droid-live]", "d"],
            ["after"],
        ]);
    });
});
