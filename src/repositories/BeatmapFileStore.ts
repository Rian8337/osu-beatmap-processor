import type { Config } from "@/config/config";
import { dependencyTokens } from "@/dependencies/tokens";
import { Injectable } from "@/server";
import { getErrorMessage } from "@/utils/getErrorMessage";
import { randomBytes } from "node:crypto";
import {
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { inject } from "tsyringe";
import type { IBeatmapFileStore } from "./IBeatmapFileStore";

function isMissing(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
    );
}

// What writeAtomically names its temporary files: `<beatmap ID>.osu.<12 hex digits>.tmp`.
const temporaryFileNamePattern = /^\d+\.osu\.[0-9a-f]{12}\.tmp$/;

/**
 * `.osu` files in `BEATMAP_FILE_DIRECTORY`, named `<beatmap ID>.osu`.
 */
@Injectable(dependencyTokens.beatmapFileStore)
export class BeatmapFileStore implements IBeatmapFileStore {
    private directoryCreation: Promise<void> | undefined;

    constructor(
        @inject(dependencyTokens.config)
        private readonly config: Pick<Config, "beatmapFileDirectory">,
    ) {}

    async read(beatmapId: number): Promise<Buffer | null> {
        try {
            return await readFile(this.getFilePath(beatmapId));
        } catch (e) {
            if (isMissing(e)) {
                return null;
            }

            throw e;
        }
    }

    async write(beatmapId: number, data: Buffer): Promise<void> {
        await this.ensureDirectory();

        try {
            await this.writeAtomically(beatmapId, data);
        } catch (e) {
            if (!isMissing(e)) {
                throw e;
            }

            // The directory was removed while running: forget that it was created, create it again, and retry once.
            this.directoryCreation = undefined;

            await this.ensureDirectory();
            await this.writeAtomically(beatmapId, data);
        }
    }

    async delete(beatmapId: number): Promise<void> {
        await rm(this.getFilePath(beatmapId), { force: true });
    }

    async removeStaleTemporaryFiles(olderThanMs: number): Promise<number> {
        let names: string[];

        try {
            names = await readdir(this.config.beatmapFileDirectory);
        } catch (e) {
            if (!isMissing(e)) {
                console.error(
                    "Failed to list the beatmap file directory for stale temporary files:",
                    getErrorMessage(e),
                );
            }

            return 0;
        }

        const threshold = Date.now() - olderThanMs;
        let removed = 0;

        for (const name of names) {
            if (!temporaryFileNamePattern.test(name)) {
                continue;
            }

            const path = join(this.config.beatmapFileDirectory, name);

            try {
                if ((await stat(path)).mtimeMs >= threshold) {
                    continue;
                }

                await rm(path);
                removed++;
            } catch (e) {
                console.error(
                    `Failed to remove the stale temporary file ${name}:`,
                    getErrorMessage(e),
                );
            }
        }

        return removed;
    }

    private async writeAtomically(
        beatmapId: number,
        data: Buffer,
    ): Promise<void> {
        const target = this.getFilePath(beatmapId);
        // A reader or a crash never sees a partial file: the rename replaces the file in one step.
        const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;

        try {
            await writeFile(temporary, data);
            await rename(temporary, target);
        } catch (e) {
            await rm(temporary, { force: true });

            throw e;
        }
    }

    private getFilePath(beatmapId: number): string {
        return join(
            this.config.beatmapFileDirectory,
            `${beatmapId.toString()}.osu`,
        );
    }

    private ensureDirectory(): Promise<void> {
        this.directoryCreation ??= mkdir(this.config.beatmapFileDirectory, {
            recursive: true,
        }).then(
            () => undefined,
            (e: unknown) => {
                // Let a later write try again.
                this.directoryCreation = undefined;

                throw e;
            },
        );

        return this.directoryCreation;
    }
}
