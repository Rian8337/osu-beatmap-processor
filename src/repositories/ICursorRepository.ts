export interface ICursorRepository {
    getCursor(command: string): Promise<Date | null>;
    setCursor(command: string, cursor: Date): Promise<void>;
    clearCursor(command: string): Promise<void>;
}
