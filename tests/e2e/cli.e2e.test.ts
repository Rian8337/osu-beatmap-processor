import { startTestPostgres } from "@/server/testing";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../../dist/cli.mjs", import.meta.url));

describe("dist/cli.mjs", () => {
    it("migrates a new database and manages keys", async () => {
        await using postgres = await startTestPostgres();
        const env = {
            PATH: process.env.PATH,
            CI: "1",
            POSTGRES_HOSTNAME: "127.0.0.1",
            POSTGRES_PORT: postgres.port.toString(),
            POSTGRES_DB_NAME: "postgres",
            POSTGRES_USERNAME: "postgres",
        };

        const created = await run(
            "node",
            [script, "key", "create", "site", "--lane", "bulk", "--unlimited"],
            { env },
        );

        expect(created.stdout).toMatch(/^Key: [A-Za-z0-9_-]{43}$/m);

        const listed = await run("node", [script, "key", "list"], { env });

        expect(listed.stdout).toMatch(/^site\s+bulk\s+unlimited/m);

        await expect(
            run("node", [script, "frobnicate"], { env }),
        ).rejects.toMatchObject({ code: 1 });
    });
});
