import { describe, expect, it } from "vitest";
import { createDocument, createEditor, createNodeFactory, createSequentialIdGenerator } from "@convetlib/core";
import { registerEditingCommands, setSelection } from "../src/index";
import { copySelection, htmlToClipboardPayload, pasteClipboardPayload, type ClipboardPayload } from "../src/clipboard";

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
});
