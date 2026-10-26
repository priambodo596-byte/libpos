import { describe, expect, it } from "vitest";
import { createDocument, createNodeFactory, createSequentialIdGenerator } from "@convetlib/core";
import { exportDocx } from "../src/index";

describe("DOCX export adapter", () => {
  it("creates a non-empty OOXML DOCX package from paragraphs, headings, tables and page breaks", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const title = f.heading(1, "Document title");
    const paragraph = f.paragraph([
      f.text("Bold text", [{ type: "bold" }]),
      f.text(" and plain text"),
      f.placeholder("letter.number"),
    ]);
    const table = f.table([["Name", "Value"], ["Example", "42"]]);
    const doc = createDocument({
      ids,
      title: "Export test",
      content: [title, paragraph, table, f.pageBreak(), f.paragraph("Second page")],
    });

    const bytes = await exportDocx(doc);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
  });

  it("uses a readable image fallback when no image resolver is provided", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const doc = createDocument({ ids, content: [f.image("https://example.com/logo.png", { alt: "Company logo" })] });
    const bytes = await exportDocx(doc);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
  });

  it("rejects missing document sections", async () => {
    await expect(exportDocx({ sections: [] } as never)).rejects.toThrow(/at least one section/);
  });
});
