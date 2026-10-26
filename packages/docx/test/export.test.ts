import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Schema, createDocument, createNodeFactory, createSequentialIdGenerator, type BlockNode } from "@convetlib/core";
import { exportDocx, importDocx } from "../src/index";

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

  it("imports embedded DOCX images as editable image nodes with data URIs", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const doc = createDocument({ ids, content: [f.paragraph("Logo follows"), f.image("fixture:logo", { alt: "Test logo", width: 32, height: 32 })] });
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII="), c => c.charCodeAt(0));
    const bytes = await exportDocx(doc, { resolveImage: async () => ({ data: png, type: "png" }) });
    const imported = await importDocx(bytes);
    const images = imported.sections[0]?.content.filter(node => node.type === "image") ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]?.attrs).toMatchObject({ alt: "Imported image", width: 32, height: 32 });
    expect(images[0]?.attrs?.src).toContain("data:image/png;base64,");
  });

  it("imports exported DOCX paragraphs, headings, marks, tables, and page geometry", async () => {
    const ids = createSequentialIdGenerator();
    const f = createNodeFactory(ids);
    const doc = createDocument({
      ids,
      title: "Import round trip",
      now: "2026-02-03T04:05:06.000Z",
      content: [
        f.heading(2, "Heading from Word"),
        f.paragraph([f.text("Important", [{ type: "bold" }]), f.text(" plain")]),
        f.table([["Name", "Value"], ["Example", "42"]]),
      ],
    });
    const bytes = await exportDocx(doc);
    const imported = await importDocx(bytes, { title: "Imported test", now: "2026-02-03T04:05:06.000Z" });
    expect(imported.meta.title).toBe("Imported test");
    expect(imported.sections).toHaveLength(1);
    expect(imported.sections[0]?.content.map(node => node.type)).toEqual(["heading", "paragraph", "table"]);
    expect(imported.sections[0]?.content[0]?.attrs?.level).toBe(2);
    const paragraphNode = imported.sections[0]?.content[1];
    expect(paragraphNode?.content?.[0]).toMatchObject({ type: "text", text: "Important", marks: [{ type: "bold" }] });
    const tableNode = imported.sections[0]?.content[2];
    expect(tableNode?.content).toHaveLength(2);
    expect(imported.sections[0]?.page.size.width).toBeGreaterThan(10000);
    expect(imported.sections[0]?.page.size.width).toBeLessThan(13000);
    expect(imported.sections[0]?.page.margins.left).toBeGreaterThan(1000);
    expect(imported.sections[0]?.page.margins.left).toBeLessThan(2000);
  });

  it("imports adjacent Word numbering paragraphs as a structured ordered list", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Second</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
    zip.file("word/numbering.xml", `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="0"/></w:num></w:numbering>`);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const imported = await importDocx(bytes);
    const list = imported.sections[0]?.content[0];
    expect(list?.type).toBe("orderedList");
    expect(list?.attrs?.start).toBe(3);
    expect(list?.content).toHaveLength(2);
    expect(list?.content?.[0]).toMatchObject({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] });
  });

  it("imports nested numbering levels and per-list start overrides", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="12"/></w:numPr></w:pPr><w:r><w:t>Parent item</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="12"/></w:numPr></w:pPr><w:r><w:t>Nested bullet</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="12"/></w:numPr></w:pPr><w:r><w:t>Second parent</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
    zip.file("word/numbering.xml", `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="12"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num></w:numbering>`);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const imported = await importDocx(bytes);
    const list = imported.sections[0]?.content[0];
    expect(list).toMatchObject({ type: "orderedList", attrs: { start: 5 } });
    expect(list?.content).toHaveLength(2);
    const firstItem = list?.content?.[0] as BlockNode | undefined;
    const nestedList = firstItem?.content?.[1] as BlockNode | undefined;
    const secondItem = list?.content?.[1] as BlockNode | undefined;
    expect(nestedList).toMatchObject({ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Nested bullet" }] }] }] });
    expect(secondItem?.content?.[0]).toMatchObject({ type: "paragraph", content: [{ type: "text", text: "Second parent" }] });
  });

  it("imports Word table geometry, cell shading, vertical alignment, spans, and borders", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tr><w:trPr><w:trHeight w:val="480"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/><w:gridSpan w:val="2"/><w:shd w:fill="DDEEFF"/><w:vAlign w:val="center"/><w:tcBorders><w:top w:val="single" w:sz="8" w:color="336699"/><w:left w:val="nil"/></w:tcBorders></w:tcPr><w:p><w:r><w:t>Styled cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const imported = await importDocx(bytes);
    const table = imported.sections[0]?.content[0] as BlockNode | undefined;
    expect(table).toMatchObject({ type: "table", attrs: { width: 9000, layout: "fixed" } });
    const row = table?.content?.[0] as BlockNode | undefined;
    const cell = row?.content?.[0] as BlockNode | undefined;
    expect(row).toMatchObject({ type: "tableRow", attrs: { height: 480 } });
    expect(cell).toMatchObject({ type: "tableCell", attrs: { width: 4500, colspan: 2, backgroundColor: "#DDEEFF", verticalAlign: "center", borderTop: "1.3333333333333333px solid #336699", borderLeft: "none" } });
    expect(Schema.create().validate(imported)).toEqual([]);
  });

  it("imports safe hyperlinks and default section headers and footers", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:hyperlink r:id="rLink"><w:r><w:t>Open site</w:t></w:r></w:hyperlink></w:p><w:sectPr><w:headerReference w:type="default" r:id="rHeader"/><w:footerReference w:type="default" r:id="rFooter"/></w:sectPr></w:body></w:document>`);
    zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/path" TargetMode="External"/><Relationship Id="rHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`);
    zip.file("word/header1.xml", `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Company Header</w:t></w:r></w:p></w:hdr>`);
    zip.file("word/footer1.xml", `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Page Footer</w:t></w:r></w:p></w:ftr>`);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const imported = await importDocx(bytes);
    const paragraph = imported.sections[0]?.content[0];
    expect(paragraph?.content?.[0]).toMatchObject({ type: "text", text: "Open site", marks: [{ type: "link", attrs: { href: "https://example.com/path" } }] });
    expect(imported.sections[0]?.header?.[0]?.content?.[0]).toMatchObject({ type: "text", text: "Company Header" });
    expect(imported.sections[0]?.footer?.[0]?.content?.[0]).toMatchObject({ type: "text", text: "Page Footer" });
  });

  it("imports inherited custom paragraph styles and direct paragraph spacing and indentation", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="BodyCustom"/><w:spacing w:after="360"/><w:ind w:left="720" w:firstLine="240"/></w:pPr><w:r><w:t>Styled paragraph</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
    zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="BaseText"><w:name w:val="Base Text"/><w:pPr><w:spacing w:before="120" w:after="240"/><w:jc w:val="center"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="BodyCustom"><w:name w:val="Custom Body"/><w:basedOn w:val="BaseText"/><w:pPr><w:ind w:right="360"/></w:pPr></w:style></w:styles>`);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const imported = await importDocx(bytes);
    const paragraph = imported.sections[0]?.content[0];
    expect(paragraph?.type).toBe("paragraph");
    expect(paragraph?.attrs).toMatchObject({ styleId: "BodyCustom", styleName: "Custom Body", styleBasedOn: "BaseText", align: "center", spacingBefore: 120, spacingAfter: 360, indentLeft: 720, indentRight: 360, firstLineIndent: 240 });
    expect(Schema.create().validate(imported)).toEqual([]);
  });

  it("resolves character style inheritance and gives direct run properties precedence", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="EmphasisCustom"/><w:i w:val="0"/><w:vertAlign w:val="superscript"/></w:rPr><w:t>Styled run</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
    zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="BaseBody"><w:rPr><w:b/><w:i/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="BodyText"><w:basedOn w:val="BaseBody"/></w:style><w:style w:type="character" w:styleId="BaseEmphasis"><w:rPr><w:u w:val="single"/></w:rPr></w:style><w:style w:type="character" w:styleId="EmphasisCustom"><w:basedOn w:val="BaseEmphasis"/><w:rPr><w:b w:val="0"/><w:i/></w:rPr></w:style></w:styles>`);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const imported = await importDocx(bytes);
    const textNode = imported.sections[0]?.content[0]?.content?.[0];
    expect(textNode).toMatchObject({ type: "text", text: "Styled run", marks: [{ type: "underline" }, { type: "superscript" }] });
    expect(textNode && "marks" in textNode ? textNode.marks?.some(mark => mark.type === "bold" || mark.type === "italic") : false).toBe(false);
  });

  it("imports Word font family, point size, text color, and highlight formatting", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:color w:val="C00000"/><w:highlight w:val="yellow"/></w:rPr><w:t>Formatted text</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const imported = await importDocx(bytes);
    const textNode = imported.sections[0]?.content[0]?.content?.[0];
    expect(textNode).toMatchObject({ type: "text", text: "Formatted text", marks: [{ type: "textStyle", attrs: { fontFamily: "Arial", fontSize: 12, color: "#C00000" } }, { type: "highlight", attrs: { color: "#ffff00" } }] });
    expect(Schema.create().validate(imported)).toEqual([]);
  });

  it("keeps images within the matching numbered list item", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Item with image</w:t></w:r><w:r><w:drawing><wp:inline><wp:extent cx="304800" cy="304800"/><a:graphic><a:graphicData><a:blip r:embed="rImage"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Following item</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
    zip.file("word/numbering.xml", `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="0"/></w:num></w:numbering>`);
    zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`);
    zip.file("word/media/image1.png", Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII="), c => c.charCodeAt(0)));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const imported = await importDocx(bytes);
    const list = imported.sections[0]?.content[0];
    expect(list?.type).toBe("orderedList");
    expect(list?.content).toHaveLength(2);
    const firstItem = list?.content?.[0] as BlockNode | undefined;
    const secondItem = list?.content?.[1] as BlockNode | undefined;
    expect(firstItem?.content?.map(node => node.type)).toEqual(["paragraph", "image"]);
    expect((firstItem?.content?.[0] as BlockNode | undefined)?.content).toEqual([{ type: "text", text: "Item with image" }]);
    expect(secondItem?.content?.map(node => node.type)).toEqual(["paragraph"]);
    expect(imported.sections[0]?.content).toHaveLength(1);
  });

  it("rejects invalid ZIP input and enforces the configured input limit", async () => {
    await expect(importDocx(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    await expect(importDocx(new Uint8Array(32), { maxInputBytes: 16 })).rejects.toThrow(/16 bytes/);
  });

  it("rejects missing document sections", async () => {
    await expect(exportDocx({ sections: [] } as never)).rejects.toThrow(/at least one section/);
  });
});
