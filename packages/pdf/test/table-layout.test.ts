import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { createDocument, createNodeFactory, createSequentialIdGenerator, type BlockNode } from "@convetlib/core";
import { exportPdf } from "../src/index";
import { buildTableGrid, computeRowHeights, rowGroups } from "../src/table-layout";

type Spec = { text: string; colspan?: number; rowspan?: number };
function table(rows: Spec[][]): { node: BlockNode; ids: ReturnType<typeof createSequentialIdGenerator> } {
  const ids = createSequentialIdGenerator();
  const f = createNodeFactory(ids);
  const node = f.block("table", rows.map(cells => f.block("tableRow", cells.map(c => f.block("tableCell", [f.paragraph(c.text)], {
    ...(c.colspan !== undefined ? { colspan: c.colspan } : {}), ...(c.rowspan !== undefined ? { rowspan: c.rowspan } : {}),
  })))));
  return { node, ids };
}
const textOf = (cell: BlockNode) => JSON.stringify(cell.content).match(/"text":"([^"]*)"/)?.[1] ?? "";

describe("PDF table grid layout", () => {
  it("places cells around columns held by a rowspan", () => {
    const grid = buildTableGrid(table([[{ text: "A", rowspan: 2 }, { text: "B", colspan: 2 }], [{ text: "C" }, { text: "D" }]]).node, textOf);
    expect(grid.columns).toBe(3);
    expect(grid.cells.map(c => `${c.text}@${c.row},${c.col}:${c.colspan}x${c.rowspan}`)).toEqual(["A@0,0:1x2", "B@0,1:2x1", "C@1,1:1x1", "D@1,2:1x1"]);
  });

  it("clamps invalid spans", () => {
    const grid = buildTableGrid(table([[{ text: "A", colspan: 0 }, { text: "B", rowspan: 99 }], [{ text: "C" }]]).node, textOf);
    expect(grid.cells.map(c => `${c.text}:${c.colspan}x${c.rowspan}`)).toEqual(["A:1x1", "B:1x2", "C:1x1"]);
  });

  it("grows only the last spanned row when a tall merged cell needs more height", () => {
    const grid = buildTableGrid(table([[{ text: "tall", rowspan: 2 }, { text: "x" }], [{ text: "y" }]]).node, textOf);
    const heights = computeRowHeights(grid, c => (c.text === "tall" ? 100 : 10), 10);
    expect(heights).toEqual([10, 90]);
  });

  it("keeps rows joined by a rowspan in the same group", () => {
    const grid = buildTableGrid(table([[{ text: "h" }, { text: "h" }], [{ text: "a", rowspan: 2 }, { text: "b" }], [{ text: "c" }], [{ text: "d" }, { text: "e" }]]).node, textOf);
    expect(rowGroups(grid)).toEqual([[0, 0], [1, 2], [3, 3]]);
  });
});

describe("PDF merged table export", () => {
  it("draws a merged cell as one rectangle spanning its columns and rows", async () => {
    const { node, ids } = table([[{ text: "A", rowspan: 2 }, { text: "B", colspan: 2 }], [{ text: "C" }, { text: "D" }]]);
    const spy = vi.spyOn(PDFPage.prototype, "drawRectangle");
    try {
      const bytes = await exportPdf(createDocument({ ids, content: [node] }));
      const rects = spy.mock.calls.map(([o]) => o as { x: number; y: number; width: number; height: number });
      expect(rects).toHaveLength(4);
      const [a, b, c, d] = rects as [typeof rects[0], typeof rects[0], typeof rects[0], typeof rects[0]];
      expect(b.width).toBeCloseTo(c.width + d.width, 5);
      expect(a.height).toBeCloseTo(b.height + c.height, 5);
      expect(c.x).toBeCloseTo(a.x + a.width, 5);
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    } finally { spy.mockRestore(); }
  });

  it("keeps rowspan groups whole on a page, inside the margin, and repeats the header", async () => {
    const rows: Spec[][] = [[{ text: "Head" }, { text: "Head" }]];
    for (let i = 0; i < 40; i += 1) rows.push([{ text: `m${i}`, rowspan: 2 }, { text: `a${i}` }], [{ text: `b${i}` }]);
    const { node, ids } = table(rows);
    const byPage = new Map<PDFPage, Array<{ x: number; y: number; width: number; height: number }>>();
    const spy = vi.spyOn(PDFPage.prototype, "drawRectangle").mockImplementation(function (this: PDFPage, o) {
      byPage.set(this, [...(byPage.get(this) ?? []), o as { x: number; y: number; width: number; height: number }]);
      return this;
    });
    try {
      const bytes = await exportPdf(createDocument({ ids, content: [node] }));
      expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
      const pages = [...byPage.values()];
      expect(pages.length).toBeGreaterThan(1);
      const bottomMargin = 72; // default A4 margins are 1440 twips = 72pt
      for (const rects of pages) for (const r of rects) expect(r.y).toBeGreaterThanOrEqual(bottomMargin - 0.01);
      // Header (two single-row cells) is repeated first on every page.
      const headerHeight = pages[0]![0]!.height;
      for (const rects of pages) { expect(rects[0]!.height).toBeCloseTo(headerHeight, 5); expect(rects[0]!.x).toBeCloseTo(pages[0]![0]!.x, 5); }
      // Merged cells are never orphaned: on each page, every merged-height rectangle has its sibling rectangles drawn too.
      for (const rects of pages) {
        const merged = rects.filter(r => r.width > 0 && r.height > headerHeight * 1.5);
        for (const m of merged) expect(rects.some(r => r.x > m.x && r.y >= m.y - 0.01 && r.y + r.height <= m.y + m.height + 0.01)).toBe(true);
      }
    } finally { spy.mockRestore(); }
  });
});
