import { createShutdownHandler } from "@/server/runtime/shutdown";
import { describe, expect, it, vi } from "vitest";

describe("createShutdownHandler", () => {
    it("disposes resources in reverse registration order, then exits 0", async () => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        const order: string[] = [];
        const resources = new AsyncDisposableStack();
        const exit = vi.fn();

        resources.defer(async () => void order.push("database"));
        resources.defer(async () => void order.push("runner"));
        resources.defer(async () => void order.push("server"));

        createShutdownHandler({ resources, exit })("SIGTERM");

        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
        expect(order).toEqual(["server", "runner", "database"]);
    });

    it("ignores repeated signals", async () => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        const dispose = vi.fn(() => Promise.resolve());
        const exit = vi.fn();
        const shutdown = createShutdownHandler({
            resources: { [Symbol.asyncDispose]: dispose },
            exit,
        });

        shutdown("SIGINT");
        shutdown("SIGTERM");

        await vi.waitFor(() => expect(exit).toHaveBeenCalled());
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it("exits 1 when shutdown takes too long", () => {
        vi.useFakeTimers();
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const exit = vi.fn();
        const neverFinishes = {
            [Symbol.asyncDispose]: () => new Promise<void>(() => undefined),
        };

        createShutdownHandler({
            resources: neverFinishes,
            timeoutMs: 10_000,
            exit,
        })("SIGTERM");
        vi.advanceTimersByTime(10_000);

        expect(exit).toHaveBeenCalledWith(1);
        vi.useRealTimers();
    });

    it("still releases the other resources when one fails, then exits 1", async () => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const resources = new AsyncDisposableStack();
        const database = vi.fn(() => Promise.resolve());
        const exit = vi.fn();

        resources.defer(database);
        resources.defer(() => Promise.reject(new Error("pool stuck")));

        createShutdownHandler({ resources, exit })("SIGTERM");

        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
        expect(database).toHaveBeenCalled();
    });
});
