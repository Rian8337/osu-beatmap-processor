import type { IBeatmapFileStore } from "@/repositories/IBeatmapFileStore";

/**
 * `.osu` files in memory.
 */
export class FakeBeatmapFileStore implements IBeatmapFileStore {
    readonly files = new Map<number, Buffer>();
    shouldFailReads = false;
    shouldFailWrites = false;
    shouldFailDeletes = false;

    async read(beatmapId: number): Promise<Buffer | null> {
        if (this.shouldFailReads) {
            throw new Error("EACCES: permission denied");
        }

        return this.files.get(beatmapId) ?? null;
    }

    async write(beatmapId: number, data: Buffer): Promise<void> {
        if (this.shouldFailWrites) {
            throw new Error("EACCES: permission denied");
        }

        this.files.set(beatmapId, data);
    }

    async delete(beatmapId: number): Promise<void> {
        if (this.shouldFailDeletes) {
            throw new Error("EACCES: permission denied");
        }

        this.files.delete(beatmapId);
    }
}
