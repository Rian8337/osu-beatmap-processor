export interface IBeatmapFileStore {
    /** The file, `null` if there is none. @throws Any other read error. */
    read(beatmapId: number): Promise<Buffer | null>;
    /** Writes atomically (temporary file, then rename), creating the directory if needed. */
    write(beatmapId: number, data: Buffer): Promise<void>;
    /** Deletes the file; a missing file is fine. */
    delete(beatmapId: number): Promise<void>;
}
