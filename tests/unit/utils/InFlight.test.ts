import { InFlight } from "@/utils/InFlight";
import { describe, expect, it } from "vitest";

describe("InFlight", () => {
    it("shares one run per key while it is pending", async () => {
        const inFlight = new InFlight<string, number>();
        let starts = 0;
        let finish = (_value: number) => {};
        const start = () => {
            starts++;

            return new Promise<number>((resolve) => (finish = resolve));
        };

        const first = inFlight.run("a", start);
        const second = inFlight.run("a", start);

        expect(starts).toBe(1);
        expect(inFlight.size).toBe(1);

        finish(5);

        await expect(first).resolves.toBe(5);
        await expect(second).resolves.toBe(5);
        expect(inFlight.size).toBe(0);
    });

    it("starts again after a run settles, including a failed one", async () => {
        const inFlight = new InFlight<string, number>();

        await expect(
            inFlight.run("a", () => Promise.reject(new Error("x"))),
        ).rejects.toThrow("x");
        await expect(inFlight.run("a", () => Promise.resolve(2))).resolves.toBe(
            2,
        );
    });

    it("turns a synchronous throw into a rejection", async () => {
        const inFlight = new InFlight<string, number>();

        await expect(
            inFlight.run("a", () => {
                throw new Error("sync");
            }),
        ).rejects.toThrow("sync");
        expect(inFlight.size).toBe(0);
    });

    it("keeps keys apart", async () => {
        const inFlight = new InFlight<string, string>();

        await expect(
            Promise.all([
                inFlight.run("a", () => Promise.resolve("a")),
                inFlight.run("b", () => Promise.resolve("b")),
            ]),
        ).resolves.toEqual(["a", "b"]);
    });
});
