/**
 * Lays out rows as aligned columns separated by two spaces.
 */
export function formatTable(
    header: readonly string[],
    rows: readonly (readonly string[])[],
): string[] {
    const lines = [header, ...rows];
    const widths = header.map((_, column) =>
        Math.max(...lines.map((cells) => (cells[column] ?? "").length)),
    );

    return lines.map((cells) =>
        cells
            .map((cell, column) =>
                column === cells.length - 1
                    ? cell
                    : cell.padEnd(widths[column] ?? 0),
            )
            .join("  ")
            .trimEnd(),
    );
}
