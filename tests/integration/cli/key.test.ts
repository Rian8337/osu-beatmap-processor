import { hashApiKey } from "@/access/keys";
import { runCli } from "@/cli/run";
import { KeyRepository } from "@/repositories/KeyRepository";
import { createCliDependencies } from "@test/utils/cli";
import { createTestDatabase } from "@test/utils/database";
import { describe, expect, it } from "vitest";

describe("key commands", () => {
    it("creates a key, prints it once, and stores only its hash", async () => {
        await using database = await createTestDatabase();
        const deps = createCliDependencies(database.db);

        expect(
            await runCli(
                ["key", "create", "site", "--lane", "bulk", "--limit", "120"],
                deps,
            ),
        ).toBe(0);

        const printed = deps.output.lines.find((line) =>
            line.startsWith("Key: "),
        );
        const key = printed?.slice("Key: ".length) ?? "";

        expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(deps.output.lines).toContain(
            "Store it now; it cannot be shown again.",
        );
        expect(await new KeyRepository(database.db).listActive()).toEqual([
            {
                name: "site",
                lane: "bulk",
                rateLimitPerMinute: 120,
                keyHash: hashApiKey(key),
            },
        ]);
    });

    it.each([
        [
            ["key", "create", "Site", "--lane", "bulk", "--unlimited"],
            /Invalid name "Site"/,
        ],
        [
            ["key", "create", "site", "--unlimited"],
            /Pass --lane priority or --lane bulk/,
        ],
        [
            ["key", "create", "site", "--lane", "fast", "--unlimited"],
            /Invalid lane "fast"/,
        ],
        [
            ["key", "create", "site", "--lane", "bulk"],
            /Pass --limit <per-minute> or --unlimited/,
        ],
        [["key", "update", "site"], /Nothing to update/],
        [["key", "nope"], /Usage:/],
    ])("rejects %j", async (argv, message) => {
        await using database = await createTestDatabase();
        const deps = createCliDependencies(database.db);

        expect(await runCli(argv, deps)).toBe(1);
        expect(deps.output.errors.join("\n")).toMatch(message);
    });

    it("refuses a duplicate name", async () => {
        await using database = await createTestDatabase();
        const deps = createCliDependencies(database.db);

        await runCli(
            ["key", "create", "site", "--lane", "bulk", "--unlimited"],
            deps,
        );

        expect(
            await runCli(
                ["key", "create", "site", "--lane", "bulk", "--unlimited"],
                deps,
            ),
        ).toBe(1);
        expect(deps.output.errors).toContain(
            'A key named "site" already exists',
        );
    });

    it("updates, shows, lists, and revokes keys", async () => {
        await using database = await createTestDatabase();
        const deps = createCliDependencies(database.db);

        await runCli(
            ["key", "create", "site", "--lane", "bulk", "--limit", "60"],
            deps,
        );
        await runCli(
            ["key", "create", "bot", "--lane", "priority", "--unlimited"],
            deps,
        );

        expect(
            await runCli(
                ["key", "update", "site", "--lane", "priority", "--unlimited"],
                deps,
            ),
        ).toBe(0);

        deps.output.lines.length = 0;
        await runCli(["key", "show", "site"], deps);

        expect(deps.output.lines.slice(0, 3)).toEqual([
            "Name:     site",
            "Lane:     priority",
            "Limit:    unlimited",
        ]);

        expect(await runCli(["key", "revoke", "site"], deps)).toBe(0);
        expect(await runCli(["key", "revoke", "site"], deps)).toBe(1);
        expect(deps.output.errors).toContain("Key site is already revoked");
        expect(
            await runCli(["key", "update", "site", "--unlimited"], deps),
        ).toBe(1);

        deps.output.lines.length = 0;
        await runCli(["key", "list"], deps);

        expect(deps.output.lines[0]).toMatch(
            /^NAME\s+LANE\s+LIMIT\s+CREATED\s+REVOKED$/,
        );
        expect(deps.output.lines[1]).toMatch(
            /^bot\s+priority\s+unlimited\s+\S+\s+-$/,
        );
        expect(deps.output.lines[2]).toMatch(
            /^site\s+priority\s+unlimited\s+\S+\s+\d{4}-/,
        );
    });

    it("shows neither the key nor its hash when storing it fails", async () => {
        await using database = await createTestDatabase();
        let hash = "";
        const failingDb = new Proxy(database.db, {
            get(target, property, receiver) {
                if (property !== "insert") {
                    return Reflect.get(target, property, receiver) as unknown;
                }

                return () => ({
                    values: (row: { keyHash: string }) => {
                        hash = row.keyHash;

                        // Shaped like drizzle's error: the message embeds the parameters, the cause is the driver's.
                        return Promise.reject(
                            new Error(`Failed query: insert params: ${hash}`, {
                                cause: new Error("connection terminated"),
                            }),
                        );
                    },
                });
            },
        });
        const deps = createCliDependencies(failingDb);

        expect(
            await runCli(
                ["key", "create", "site", "--lane", "bulk", "--unlimited"],
                deps,
            ),
        ).toBe(1);

        const everything = [...deps.output.lines, ...deps.output.errors].join(
            "\n",
        );

        expect(hash).toMatch(/^[0-9a-f]+$/);
        expect(everything).not.toContain(hash);
        expect(everything).not.toMatch(/Key: /);
        expect(deps.output.errors).toEqual([
            "The command failed: connection terminated",
        ]);
    });
});
