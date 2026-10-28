import { describe, expect, it } from "vitest";
import { htmlToStructuralClipboardPayload } from "../src/html-clipboard";
import { createDocument, createEditor, createNodeFactory, createSequentialIdGenerator, type BlockNode } from "@convetlib/core";
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

  it("keeps images and surrounding text inside their originating table cell", () => {
    const payload = htmlToClipboardPayload('<table><tr><td>Before<img src="https://example.com/cell.png" alt="Cell image">After</td></tr></table>');
    const table = payload?.nodes?.[0];
    expect(payload?.nodes).toHaveLength(1);
    expect(table?.type).toBe("table");
    const row = table?.content?.[0] as BlockNode | undefined;
    const cell = row?.content?.[0] as BlockNode | undefined;
    expect(cell?.content?.map(node => node.type)).toEqual(["paragraph", "image", "paragraph"]);
    expect((cell?.content?.[0] as BlockNode | undefined)?.content?.[0]).toMatchObject({ type: "text", text: "Before" });
    expect(cell?.content?.[1]).toMatchObject({ type: "image", attrs: { src: "https://example.com/cell.png", alt: "Cell image" } });
    expect((cell?.content?.[2] as BlockNode | undefined)?.content?.[0]).toMatchObject({ type: "text", text: "After" });
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
  it("preserves safe HTML links and drops unsafe link schemes", () => {
    const payload = htmlToClipboardPayload('<p><a href="https://example.com/docs" title="Reference"><strong>Safe link</strong></a> <a href="javascript:alert(1)">unsafe</a> <a href="//evil.example">relative</a></p><table><tr><td>trigger structural import</td></tr></table>');
    const paragraph = payload?.nodes?.[0];
    expect(paragraph?.content?.[0]).toMatchObject({ type: "text", text: "Safe link", marks: [{ type: "link", attrs: { href: "https://example.com/docs", title: "Reference" } }, { type: "bold" }] });
    expect(payload?.text).toContain("unsafe");
    expect(JSON.stringify(payload?.nodes)).not.toContain("javascript:");
    expect(JSON.stringify(payload?.nodes)).not.toContain("evil.example");
  });

  it("imports ordered and nested HTML lists as semantic list nodes", () => {
    const payload = htmlToClipboardPayload('<ol start="3"><li>First</li><li>Second<ul><li><strong>Nested</strong></li></ul></li></ol>');
    expect(payload?.nodes?.[0]).toMatchObject({
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] },
        { type: "listItem", content: [
          { type: "paragraph", content: [{ type: "text", text: "Second" }] },
          { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Nested", marks: [{ type: "bold" }] }] }] }] }
        ] }
      ]
    });
  });

  it("restores the correct list parent after closing a nested list", () => {
    const payload = htmlToClipboardPayload('<ul><li>Outer one<ul><li>Inner one</li><li>Inner two</li></ul></li><li>Outer two</li></ul>');
    expect(payload?.nodes?.[0]).toMatchObject({
      type: "bulletList",
      content: [
        { type: "listItem", content: [
          { type: "paragraph", content: [{ type: "text", text: "Outer one" }] },
          { type: "bulletList", content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Inner one" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Inner two" }] }] }
          ] }
        ] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Outer two" }] }] }
      ]
    });
  });

  it("preserves valid HTML table spans and normalizes invalid spans", () => {
    const payload = htmlToClipboardPayload('<table><tr><td colspan="2" rowspan="3">Merged</td><td colspan="0">Fallback</td><td rowspan="999">Bounded</td></tr></table>');
    const table = payload?.nodes?.[0];
    const row = table?.content?.[0];
    const rowContent = row && "content" in row ? row.content : undefined;
    const cells: import("@convetlib/core").BlockNode[] = rowContent?.filter((node): node is import("@convetlib/core").BlockNode => "type" in node && node.type === "tableCell") ?? [];
    expect(cells.map(cell => cell.attrs)).toEqual([
      { colspan: 2, rowspan: 3 },
      { colspan: 1, rowspan: 1 },
      { colspan: 1, rowspan: 1 }
    ]);
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

describe("structural HTML parsing robustness", () => {
  const textOf = (html: string) => htmlToStructuralClipboardPayload(html)?.text;
  it("decodes entities in a single pass", () => {
    expect(textOf("<ul><li>a &amp;lt;b&amp;gt; &#65;&#x42; &unknown;</li></ul>")).toBe("a &lt;b&gt; AB &unknown;");
  });
  it("keeps '>' inside quoted attribute values from leaking markup", () => {
    const payload = htmlToStructuralClipboardPayload('<ul><li><a title="x>y" href="https://e.com">link</a> tail</li></ul>');
    expect(payload?.text).toBe("link tail");
    expect(JSON.stringify(payload?.nodes)).toContain("https://e.com");
  });
  it("reads href from the real attribute, not from text inside another attribute", () => {
    const payload = htmlToStructuralClipboardPayload('<ul><li><a title="see href=https://evil.example" href="https://good.example">x</a></li></ul>');
    const json = JSON.stringify(payload?.nodes);
    expect(json).toContain('"href":"https://good.example"');
    expect(json).not.toContain('"href":"https://evil.example"');
  });
  it("drops nested blocked elements completely", () => {
    expect(textOf("<ul><li>ok</li></ul><svg><svg></svg>LEAK</svg>after")).toBe("ok\nafter");
    expect(textOf("<ul><li>ok</li></ul><script>1</script>after")).toBe("ok\nafter");
  });
  it("rejects unsafe link schemes", () => {
    const json = JSON.stringify(htmlToStructuralClipboardPayload('<ul><li><a href="javascript:alert(1)">x</a><a href=" https://ok.example">y</a></li></ul>')?.nodes);
    expect(json).not.toContain("javascript:");
  });
});
