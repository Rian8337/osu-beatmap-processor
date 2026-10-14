import { CursorRepository } from "@/repositories/CursorRepository";
import { createTestDatabase } from "@test/utils/database";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

describe("CursorRepository", () => {
    it("keeps one cursor per command", async () => {
        await using database = await createTestDatabase();
        const cursorRepository = new CursorRepository(database.db);
        const first = new Date("2010-01-01T00:00:00Z");
        const second = new Date("2011-01-01T00:00:00Z");

        expect(await cursorRepository.getCursor("populate-cache")).toBeNull();

        await cursorRepository.setCursor("populate-cache", first);
        await cursorRepository.setCursor("fix-dates", second);
        await cursorRepository.setCursor("populate-cache", second);

        expect(await cursorRepository.getCursor("populate-cache")).toEqual(
            second,
        );
        expect(await cursorRepository.getCursor("fix-dates")).toEqual(second);

        await cursorRepository.clearCursor("populate-cache");

        expect(await cursorRepository.getCursor("populate-cache")).toBeNull();
        expect(await cursorRepository.getCursor("fix-dates")).toEqual(second);
    });
});
