import type { KeyListing, StoredApiKey } from "@/access/types";
import { apiKeysTable } from "@/database/schema";
import type { Database } from "@/database/types";
import { dependencyTokens } from "@/dependencies/tokens";
import type { Lane } from "@/osu/errors";
import { Injectable } from "@/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { inject } from "tsyringe";
import type { IKeyRepository } from "./IKeyRepository";

const listing = {
    name: apiKeysTable.name,
    lane: apiKeysTable.lane,
    rateLimitPerMinute: apiKeysTable.rateLimitPerMinute,
    createdAt: apiKeysTable.createdAt,
    revokedAt: apiKeysTable.revokedAt,
};

@Injectable(dependencyTokens.keyRepository)
export class KeyRepository implements IKeyRepository {
    constructor(@inject(dependencyTokens.db) private readonly db: Database) {}

    listActive(): Promise<StoredApiKey[]> {
        return this.db
            .select({
                name: apiKeysTable.name,
                lane: apiKeysTable.lane,
                rateLimitPerMinute: apiKeysTable.rateLimitPerMinute,
                keyHash: apiKeysTable.keyHash,
            })
            .from(apiKeysTable)
            .where(isNull(apiKeysTable.revokedAt))
            .orderBy(asc(apiKeysTable.name));
    }

    list(): Promise<KeyListing[]> {
        return this.db
            .select(listing)
            .from(apiKeysTable)
            .orderBy(asc(apiKeysTable.name));
    }

    async findByName(name: string): Promise<KeyListing | null> {
        const [key] = await this.db
            .select(listing)
            .from(apiKeysTable)
            .where(eq(apiKeysTable.name, name))
            .limit(1);

        return key ?? null;
    }

    async insert(key: {
        name: string;
        keyHash: string;
        lane: Lane;
        rateLimitPerMinute: number | null;
    }): Promise<void> {
        await this.db.insert(apiKeysTable).values(key);
    }

    async update(
        name: string,
        changes: { lane?: Lane; rateLimitPerMinute?: number | null },
    ): Promise<void> {
        await this.db
            .update(apiKeysTable)
            .set(changes)
            .where(eq(apiKeysTable.name, name));
    }

    async revoke(name: string): Promise<boolean> {
        const revoked = await this.db
            .update(apiKeysTable)
            .set({ revokedAt: new Date() })
            .where(
                and(
                    eq(apiKeysTable.name, name),
                    isNull(apiKeysTable.revokedAt),
                ),
            )
            .returning({ name: apiKeysTable.name });

        return revoked.length > 0;
    }
}
