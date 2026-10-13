import { LruCache } from "@/cache/LruCache";
import { describe, expect, it } from "vitest";

describe("LruCache", () => {
    it("evicts the least recently used entry when full", () => {
        const cache = new LruCache<string, number>(2);

        cache.set("a", 1);
        cache.set("b", 2);
        // Touch "a" so "b" becomes least recently used.
        expect(cache.get("a")).toBe(1);
        cache.set("c", 3);

        expect(cache.get("b")).toBeUndefined();
        expect(cache.get("a")).toBe(1);
        expect(cache.get("c")).toBe(3);
        expect(cache.size).toBe(2);
    });

    it("expires entries after the TTL", () => {
        let time = 0;
        const cache = new LruCache<string, number>(10, 100, () => time);

        cache.set("a", 1);
        time = 99;
        expect(cache.get("a")).toBe(1);
        time = 100;
        expect(cache.get("a")).toBeUndefined();
        expect(cache.size).toBe(0);
    });

    it("deletes entries", () => {
        const cache = new LruCache<string, number>(10);

        cache.set("a", 1);
        cache.delete("a");

        expect(cache.get("a")).toBeUndefined();
    });
});
