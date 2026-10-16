import type { Config } from "@/config/config";
import { dependencyTokens } from "@/dependencies/tokens";
import type { IKeyRepository } from "@/repositories/IKeyRepository";
import { Injectable } from "@/server";
import { getErrorMessage } from "@/utils/getErrorMessage";
import { inject } from "tsyringe";
import type { IKeyService } from "./IKeyService";
import { hashApiKey } from "./keys";
import { buildKeySnapshot, type KeySnapshot } from "./snapshot";
import type { ApiKeyRecord } from "./types";

/**
 * The keys in memory, so that authenticating never touches the database (a database outage does not lock callers
 * out).
 */
@Injectable(dependencyTokens.keyService)
export class KeyService implements IKeyService {
    private snapshot: KeySnapshot = new Map();
    /** The generation of the newest load started. */
    private latestLoadGeneration = 0;
    /** The generation of the loaded snapshot; a load that finishes with an older one is stale. */
    private appliedLoadGeneration = 0;

    constructor(
        @inject(dependencyTokens.keyRepository)
        private readonly keyRepository: Pick<IKeyRepository, "listActive">,
        @inject(dependencyTokens.config)
        private readonly config: Pick<
            Config,
            "builtInKeys" | "keyReloadIntervalSeconds"
        >,
    ) {}

    async load(): Promise<void> {
        // Loads can overlap (timer and SIGHUP); one that started earlier must not replace a newer snapshot.
        const generation = ++this.latestLoadGeneration;
        const stored = await this.keyRepository.listActive();

        if (generation < this.appliedLoadGeneration) {
            return;
        }

        this.appliedLoadGeneration = generation;
        this.snapshot = buildKeySnapshot(stored, this.config.builtInKeys);
    }

    async reload(): Promise<boolean> {
        try {
            await this.load();

            return true;
        } catch (e) {
            console.error(
                "Failed to reload the API keys; keeping the previous ones:",
                getErrorMessage(e),
            );

            return false;
        }
    }

    startReloading(): Disposable {
        const timer = setInterval(() => {
            void this.reload();
        }, this.config.keyReloadIntervalSeconds * 1000);

        timer.unref();

        return { [Symbol.dispose]: () => clearInterval(timer) };
    }

    authenticate(rawKey: string): ApiKeyRecord | undefined {
        // The map lookup compares hashes, not keys, so its timing reveals nothing usable about stored keys.
        return this.snapshot.get(hashApiKey(rawKey));
    }

    describeKeys(): string {
        const { builtInKeys } = this.config;
        const builtIn = [builtInKeys.priority, builtInKeys.bulk].filter(
            (key) => key !== undefined,
        ).length;

        return `${this.snapshot.size.toString()} keys (${builtIn.toString()} built in)`;
    }
}
