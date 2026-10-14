import type { KeyListing, StoredApiKey } from "@/access/types";
import type { Lane } from "@/osu/errors";

export interface IKeyRepository {
    /**
     * Unrevoked keys.
     */
    listActive(): Promise<StoredApiKey[]>;

    /**
     * Every key, revoked ones included, by name.
     */
    list(): Promise<KeyListing[]>;

    findByName(name: string): Promise<KeyListing | null>;

    insert(key: {
        name: string;
        keyHash: string;
        lane: Lane;
        rateLimitPerMinute: number | null;
    }): Promise<void>;

    update(
        name: string,
        changes: { lane?: Lane; rateLimitPerMinute?: number | null },
    ): Promise<void>;

    /**
     * @returns `false` if the key was already revoked.
     */
    revoke(name: string): Promise<boolean>;
}
