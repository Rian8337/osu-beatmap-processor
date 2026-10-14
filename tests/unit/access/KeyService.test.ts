import { hashApiKey } from "@/access/keys";
import { KeyService } from "@/access/KeyService";
import type { StoredApiKey } from "@/access/types";
import { silenceConsoleErrors } from "@test/utils/silenceConsoleErrors";
import { afterEach, describe, expect, it, vi } from "vitest";

const stored = (name: string): StoredApiKey => ({
    name,
    lane: "bulk",
    rateLimitPerMinute: 60,
    keyHash: hashApiKey(`${name}-key`),
});

const config = {
    builtInKeys: { priority: "internal", bulk: undefined },
    keyReloadIntervalSeconds: 30,
};

afterEach(() => {
    vi.useRealTimers();
});

describe("KeyService", () => {
    it("authenticates built-in and stored keys after loading", async () => {
        const service = new KeyService(
            { listActive: () => Promise.resolve([stored("site")]) },
            config,
        );

        expect(service.authenticate("internal")).toBeUndefined();

        await service.load();

        expect(service.authenticate("internal")?.lane).toBe("priority");
        expect(service.authenticate("site-key")?.name).toBe("site");
        expect(service.authenticate("wrong")).toBeUndefined();
        expect(service.describeKeys()).toBe("2 keys (1 built in)");
    });

    it("keeps the previous keys when a reload fails", async () => {
        const log = silenceConsoleErrors();
        const listActive = vi
            .fn<() => Promise<StoredApiKey[]>>()
            .mockResolvedValueOnce([stored("site")])
            .mockRejectedValueOnce(new Error("database down"));
        const service = new KeyService({ listActive }, config);

        await service.load();

        expect(await service.reload()).toBe(false);
        expect(service.authenticate("site-key")?.name).toBe("site");
        expect(log).toHaveBeenCalled();
    });

    it("never lets an older load replace a newer one", async () => {
        let finishFirst = (_keys: StoredApiKey[]) => {};
        const listActive = vi
            .fn<() => Promise<StoredApiKey[]>>()
            .mockReturnValueOnce(
                new Promise((resolve) => (finishFirst = resolve)),
            )
            .mockResolvedValueOnce([stored("newer")]);
        const service = new KeyService({ listActive }, config);

        const first = service.load();

        await service.load();
        finishFirst([stored("older")]);
        await first;

        expect(service.authenticate("newer-key")).toBeDefined();
        expect(service.authenticate("older-key")).toBeUndefined();
    });

    it("reloads on its interval until disposed", async () => {
        vi.useFakeTimers();

        const listActive = vi
            .fn<() => Promise<StoredApiKey[]>>()
            .mockResolvedValue([]);
        const service = new KeyService({ listActive }, config);
        const reloading = service.startReloading();

        await vi.advanceTimersByTimeAsync(30_000);

        expect(listActive).toHaveBeenCalledTimes(1);

        reloading[Symbol.dispose]();
        await vi.advanceTimersByTimeAsync(60_000);

        expect(listActive).toHaveBeenCalledTimes(1);
    });
});
