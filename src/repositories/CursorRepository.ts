import { cliCursorTable } from "@/database/schema";
import type { Database } from "@/database/types";
import { dependencyTokens } from "@/dependencies/tokens";
import { Injectable } from "@/server";
import { eq } from "drizzle-orm";
import { inject } from "tsyringe";
import type { ICursorRepository } from "./ICursorRepository";

@Injectable(dependencyTokens.cursorRepository)
export class CursorRepository implements ICursorRepository {
    constructor(@inject(dependencyTokens.db) private readonly db: Database) {}

    async getCursor(command: string): Promise<Date | null> {
        const [row] = await this.db
            .select({ cursor: cliCursorTable.cursor })
            .from(cliCursorTable)
            .where(eq(cliCursorTable.command, command))
            .limit(1);

        return row?.cursor ?? null;
    }

    async setCursor(command: string, cursor: Date): Promise<void> {
        await this.db
            .insert(cliCursorTable)
            .values({ command, cursor })
            .onConflictDoUpdate({
                target: cliCursorTable.command,
                set: { cursor },
            });
    }

    async clearCursor(command: string): Promise<void> {
        await this.db
            .delete(cliCursorTable)
            .where(eq(cliCursorTable.command, command));
    }
}
