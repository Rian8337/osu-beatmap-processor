import type { ICursorRepository } from "@/repositories/ICursorRepository";

/**
 * CLI cursorRepository in memory.
 */
export class FakeCursorRepository implements ICursorRepository {
    readonly cursorsByCommand = new Map<string, Date>();

    async getCursor(command: string): Promise<Date | null> {
        return this.cursorsByCommand.get(command) ?? null;
    }

    async setCursor(command: string, cursor: Date): Promise<void> {
        this.cursorsByCommand.set(command, cursor);
    }

    async clearCursor(command: string): Promise<void> {
        this.cursorsByCommand.delete(command);
    }
}
