import type { ApiKeyRecord } from "./types";

export interface IKeyService {
    /**
     * Loads the keys.
     *
     * @throws If the database cannot be read.
     */
    load(): Promise<void>;

    /**
     * Loads the keys; on failure logs and keeps the previous ones.
     *
     * @returns Whether it loaded.
     */
    reload(): Promise<boolean>;

    /**
     * Reloads every `KEY_RELOAD_INTERVAL_SECONDS`; disposing stops it.
     */
    startReloading(): Disposable;

    authenticate(rawKey: string): ApiKeyRecord | undefined;

    describeKeys(): string;
}
