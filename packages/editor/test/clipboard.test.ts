import { describe, expect, it } from "vitest";
import { createDocument, createEditor, createNodeFactory, createSequentialIdGenerator } from "@convetlib/core";
import { registerEditingCommands, setSelection } from "../src/index";
import { copySelection, cutSelection, htmlToClipboardPayload, pasteClipboardPayload, type ClipboardPayload } from "../src/clipboard";

describe("clipboard interoperability", () => {
  it("imports paragraphs, headings, and supported nested inline marks", () => {
    const payload = htmlToClipboardPayload("<h2>Title</h2><p>A <strong>bold <em>and italic</em></strong> word<br>next</p>");
    expect(payload?.text).toBe("Title\nA bold and italic word\nnext");
    expect(payload?.blocks?.map((b) => b.type)).toEqual(["heading", "paragraph"]);
    expect(payload?.blocks?.[0]?.attrs).toEqual({ level: 2 });
    expect(payload?.blocks?.[1]?.runs).toContainEqual({ text: "bold ", marks: [{ type: "bold" }] });
    expect(payload?.blocks?.[1]?.runs).toContainEqual({ text: "and italic", marks: [{ type: "bold" }, { type: "italic" }] });
  });

  it("drops active content and ignores HTML attributes instead of importing them", () => {
    const payload = htmlToClipboardPayload('<p onclick="alert(1)">Safe <img src=x onerror=alert(1)> text</p><script>alert("bad")</script><iframe src="evil">evil frame</iframe>');
    expect(payload?.text).toBe("Safe  text");
    expect(payload?.html).not.toContain("onclick");
    expect(payload?.html).not.toContain("onerror");
    expect(payload?.html).not.toContain("<script");
    expect(payload?.text).not.toContain("bad");
    expect(payload?.text).not.toContain("evil frame");
  });

  it("imports mixed HTML in paragraph-image-table-paragraph order and strips unsafe markup", () => {
    const payload = htmlToClipboardPayload('<p>Before</p><img src="https://example.com/pic.png" onerror="alert(1)"><table><tr><td><p>Cell</p></td></tr></table><p>After</p><img src="javascript:alert(1)"><script>bad()</script>');
    expect(payload?.nodes?.map(node => node.type)).toEqual(["paragraph", "image", "table", "paragraph"]);
    expect(payload?.text).toContain("Before");
    expect(payload?.text).toContain("Cell");
    expect(payload?.text).toContain("After");
    expect(payload?.text).not.toContain("bad()");
    expect(payload?.nodes?.[1]).toMatchObject({ type: "image", attrs: { src: "https://example.com/pic.png" } });
    expect(payload?.nodes?.[2]).toMatchObject({ type: "table", content: [{ type: "tableRow" }] });
  });
  it("pastes a validated image node without flattening it to text", async () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const ed = await createEditor({ document: createDocument({ ids, content: [f.paragraph("before after")] }), ids });
    registerEditingCommands(ed, { ids });
    const paragraph = ed.state.document.sections[0]!.content[0]!;
    setSelection(ed, { anchor: { blockId: paragraph.id, offset: 7 }, head: { blockId: paragraph.id, offset: 7 } }, { ids });
    expect(pasteClipboardPayload(ed, { mime: "application/x-convetlib-fragment+json", text: "", nodes: [{ type: "image", id: "external-image", attrs: { src: "https://example.com/image.png", alt: "diagram", width: 120 } }] })).toBe(true);
    const content = ed.state.document.sections[0]!.content;
    expect(content.map(n => n.type)).toEqual(["paragraph", "image", "paragraph"]);
    expect(content[1]).toMatchObject({ type: "image", attrs: { src: "https://example.com/image.png", alt: "diagram", width: 120 } });
    expect(content[0]!.content?.map(n => "text" in n ? n.text : "").join("")).toBe("before ");
    expect(content[2]!.content?.map(n => "text" in n ? n.text : "").join("")).toBe("after");
    await ed.destroy();
  });

  it("pastes a table fragment with nested rows and cells", async () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const ed = await createEditor({ document: createDocument({ ids, content: [f.paragraph("start end")] }), ids });
    registerEditingCommands(ed, { ids });
    const paragraph = ed.state.document.sections[0]!.content[0]!;
    setSelection(ed, { anchor: { blockId: paragraph.id, offset: 6 }, head: { blockId: paragraph.id, offset: 6 } }, { ids });
    const table: import("@convetlib/core").BlockNode = { type: "table", id: "t", content: [{ type: "tableRow", id: "r", content: [{ type: "tableCell", id: "c", content: [f.paragraph("Cell value")] }] }] };
    expect(pasteClipboardPayload(ed, { mime: "application/x-convetlib-fragment+json", text: "Cell value", nodes: [table] })).toBe(true);
    const content = ed.state.document.sections[0]!.content;
    expect(content.map(n => n.type)).toEqual(["paragraph", "table", "paragraph"]);
    expect(content[1]!.content?.[0]).toMatchObject({ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Cell value" }] }] }] });
    await ed.destroy();
  });

  it("rejects unsafe image sources in structural clipboard fragments", async () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const ed = await createEditor({ document: createDocument({ ids, content: [f.paragraph("safe")] }), ids });
    registerEditingCommands(ed, { ids });
    const paragraph = ed.state.document.sections[0]!.content[0]!;
    setSelection(ed, { anchor: { blockId: paragraph.id, offset: 2 }, head: { blockId: paragraph.id, offset: 2 } }, { ids });
    expect(pasteClipboardPayload(ed, { mime: "application/x-convetlib-fragment+json", text: "", nodes: [{ type: "image", id: "bad", attrs: { src: "javascript:alert(1)" } }] })).toBe(false);
    expect(ed.state.document.sections[0]!.content).toHaveLength(1);
    await ed.destroy();
  });

  it("rejects excessively large HTML input", () => {
    expect(htmlToClipboardPayload("x".repeat(1_000_001))).toBeUndefined();
  });

  it("copies rich selected text as plain text and safe HTML", async () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const ed = await createEditor({ document: createDocument({ ids, content: [f.paragraph([{ type: "text", text: "Hello ", marks: [{ type: "bold" }] }, { type: "text", text: "world" }])] }), ids });
    registerEditingCommands(ed, { ids });
    const block = ed.state.document.sections[0]!.content[0]!;
    setSelection(ed, { anchor: { blockId: block.id, offset: 0 }, head: { blockId: block.id, offset: 11 } }, { ids });
    const payload = copySelection(ed);
    expect(payload?.text).toBe("Hello world");
    expect(payload?.html).toBe("<p><strong>Hello </strong>world</p>");
    await ed.destroy();
  });

  it("pastes a multi-paragraph rich fragment into a selected range without losing the suffix", async () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const ed = await createEditor({ document: createDocument({ ids, content: [f.paragraph("Hello brave new world!")] }), ids });
    registerEditingCommands(ed, { ids });
    const block = ed.state.document.sections[0]!.content[0]!;
    setSelection(ed, { anchor: { blockId: block.id, offset: 6 }, head: { blockId: block.id, offset: 16 } }, { ids });
    const payload: ClipboardPayload = {
      mime: "application/x-convetlib-fragment+json",
      text: "brave\nnew",
      blocks: [
        { type: "paragraph", runs: [{ text: "brave ", marks: [{ type: "bold" }] }] },
        { type: "heading", attrs: { level: 2 }, runs: [{ text: "new", marks: [] }] }
      ]
    };
    expect(pasteClipboardPayload(ed, payload)).toBe(true);
    expect(ed.state.document.sections[0]!.content.map((node) => ({
      type: node.type,
      text: (node.content ?? []).map((part) => "text" in part ? part.text : "\uFFFC").join("")
    }))).toEqual([
      { type: "paragraph", text: "Hello brave " },
      { type: "heading", text: "newworld!" }
    ]);
    expect(ed.state.document.sections[0]!.content[0]!.content?.[1]).toMatchObject({ text: "brave ", marks: [{ type: "bold" }] });
    await ed.destroy();
  });

  it("replaces a selection spanning sibling blocks with a rich multi-block fragment", async () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const ed = await createEditor({ document: createDocument({ ids, content: [f.paragraph("Alpha one"), f.paragraph("Beta two")] }), ids });
    registerEditingCommands(ed, { ids });
    const [first, second] = ed.state.document.sections[0]!.content;
    setSelection(ed, { anchor: { blockId: first!.id, offset: 6 }, head: { blockId: second!.id, offset: 4 } }, { ids });
    const payload: ClipboardPayload = {
      mime: "application/x-convetlib-fragment+json", text: "X\\nY",
      blocks: [
        { type: "paragraph", runs: [{ text: "X", marks: [{ type: "bold" }] }] },
        { type: "heading", attrs: { level: 2 }, runs: [{ text: "Y", marks: [] }] }
      ]
    };
    expect(pasteClipboardPayload(ed, payload)).toBe(true);
    expect(ed.state.document.sections[0]!.content.map(node => ({
      type: node.type,
      text: (node.content ?? []).map(part => "text" in part ? part.text : "\\uFFFC").join("")
    }))).toEqual([
      { type: "paragraph", text: "Alpha X" },
      { type: "heading", text: "Y two" }
    ]);
    await ed.destroy();
  });
  it("copies and cuts a supported selection spanning top-level content across sections", async () => {
    const ids = createSequentialIdGenerator(), f = createNodeFactory(ids);
    const doc = createDocument({ ids, content: [f.paragraph("Alpha")] });
    const firstSection = doc.sections[0]!;
    doc.sections.push({ ...firstSection, id: ids(), content: [f.paragraph("Beta")] });
    const ed = await createEditor({ document: doc, ids });
    registerEditingCommands(ed, { ids });
    const [first] = ed.state.document.sections[0]!.content;
    const [second] = ed.state.document.sections[1]!.content;
    setSelection(ed, { anchor: { blockId: first!.id, offset: 2 }, head: { blockId: second!.id, offset: 2 } }, { ids });
    expect(copySelection(ed)?.text).toBe("pha\nBe");
    expect(cutSelection(ed)?.text).toBe("pha\nBe");
    expect((ed.state.document.sections[0]!.content[0]!.content ?? []).map(n => "text" in n ? n.text : "").join("")).toBe("Al");
    expect((ed.state.document.sections[1]!.content[0]!.content ?? []).map(n => "text" in n ? n.text : "").join("")).toBe("ta");
    await ed.destroy();
  });

});
