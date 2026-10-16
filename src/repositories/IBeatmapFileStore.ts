export interface IBeatmapFileStore {
    /** The file, `null` if there is none. @throws Any other read error. */
    read(beatmapId: number): Promise<Buffer | null>;
    /** Writes atomically (temporary file, then rename), creating the directory if needed. */
    write(beatmapId: number, data: Buffer): Promise<void>;
    /** Deletes the file; a missing file is fine. */
    delete(beatmapId: number): Promise<void>;
    /**
     * Deletes the temporary files of writes that never finished (a crash leaves one behind), if they were last
     * modified more than `olderThanMs` ago, so a write in progress is never touched. A missing directory is fine; a
     * failure to list or delete is logged, not thrown.
     * @returns How many files were deleted.
     */
    removeStaleTemporaryFiles(olderThanMs: number): Promise<number>;
}
