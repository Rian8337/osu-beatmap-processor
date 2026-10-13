import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
    DatabaseConnection,
    type DatabaseSettings,
} from "@/server/database/DatabaseConnection";

const settings: DatabaseSettings = {
    host: "127.0.0.1",
    port: 1,
    name: "postgres",
    user: "postgres",
    password: "super-secret",
};

describe("DatabaseConnection", () => {
    it("logs errors of idle pooled clients instead of throwing", async () => {
        const error = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const pool = new Pool();

        await using _connection = new DatabaseConnection(settings, {}, pool);

        expect(() =>
            pool.emit("error", new Error("terminating connection")),
        ).not.toThrow();
        expect(error).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(error.mock.calls)).toContain(
            "terminating connection",
        );
        expect(JSON.stringify(error.mock.calls)).not.toContain("super-secret");
    });
});
