import type { BlockNode } from "@convetlib/core";

/** A table cell placed on the column grid. `row`/`col` are zero-based; spans are already clamped. */
export interface GridCell {
  readonly row: number;
  readonly col: number;
  readonly colspan: number;
  readonly rowspan: number;
  readonly text: string;
}

export interface TableGrid {
  readonly cells: readonly GridCell[];
  readonly rowCount: number;
  readonly columns: number;
}

const MAX_COLSPAN = 100;

/** Coerces a model span to an integer in [1, max]; anything invalid becomes 1. */
function boundedSpan(value: unknown, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, max));
}

/**
 * Places the cells of a `table` node on a column grid. The model stores no continuation cells for `rowspan`,
 * so columns already held by a span from an earlier row are skipped when placing the next cell.
 * Rows without any `tableCell` are ignored, matching the previous renderer.
 */
export function buildTableGrid(node: BlockNode, textOf: (cell: BlockNode) => string): TableGrid {
  const rowNodes = (node.content ?? []).filter((row): row is BlockNode =>
    "id" in row && row.type === "tableRow" && (row.content ?? []).some(cell => "id" in cell && cell.type === "tableCell"));
  const occupied: Array<Set<number>> = rowNodes.map(() => new Set<number>());
  const cells: GridCell[] = [];
  let columns = 0;
  rowNodes.forEach((rowNode, row) => {
    let col = 0;
    for (const child of rowNode.content ?? []) {
      if (!("id" in child) || child.type !== "tableCell") continue;
      const cell = child as BlockNode;
      while (occupied[row]!.has(col)) col += 1;
      const colspan = boundedSpan(cell.attrs?.colspan, MAX_COLSPAN);
      const rowspan = boundedSpan(cell.attrs?.rowspan, rowNodes.length - row);
      for (let r = 1; r < rowspan; r += 1) for (let c = 0; c < colspan; c += 1) occupied[row + r]!.add(col + c);
      cells.push({ row, col, colspan, rowspan, text: textOf(cell) });
      col += colspan;
      columns = Math.max(columns, col);
    }
  });
  // A rowspan may reach columns that no later cell extends; they still belong to the grid.
  occupied.forEach(set => set.forEach(c => { columns = Math.max(columns, c + 1); }));
  return { cells, rowCount: rowNodes.length, columns };
}

/**
 * Row heights for a grid. `needed(cell)` is the height the cell's content requires.
 * Single-row cells size their row first; a taller multi-row cell then grows only its last spanned row.
 */
export function computeRowHeights(grid: TableGrid, needed: (cell: GridCell) => number, minHeight: number): number[] {
  const heights = Array.from({ length: grid.rowCount }, () => minHeight);
  for (const cell of grid.cells) if (cell.rowspan === 1) heights[cell.row] = Math.max(heights[cell.row]!, needed(cell));
  for (const cell of [...grid.cells].filter(c => c.rowspan > 1).sort((a, b) => a.row - b.row)) {
    const last = cell.row + cell.rowspan - 1;
    let have = 0;
    for (let r = cell.row; r <= last; r += 1) have += heights[r]!;
    const need = needed(cell);
    if (need > have) heights[last] = heights[last]! + (need - have);
  }
  return heights;
}

/**
 * Splits rows into groups that must stay on one page: a row-spanning cell never crosses a group boundary.
 * Returns inclusive `[start, end]` row ranges.
 */
export function rowGroups(grid: TableGrid): Array<[number, number]> {
  const groups: Array<[number, number]> = [];
  let start = 0;
  let reach = 0;
  for (let row = 0; row < grid.rowCount; row += 1) {
    for (const cell of grid.cells) if (cell.row === row) reach = Math.max(reach, cell.row + cell.rowspan - 1);
    if (reach <= row) { groups.push([start, row]); start = row + 1; }
  }
  return groups;
}
