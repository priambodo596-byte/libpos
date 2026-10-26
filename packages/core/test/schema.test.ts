import { describe, expect, it } from "vitest";
import { Schema, cloneDocument, coreSchema, type IssueCode, type NodeSpec } from "../src/index";
import { makeDoc } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loose = any;

function codes(doc: unknown): IssueCode[] {
  return coreSchema.validate(doc as never).map((i) => i.code);
}

/** Clones the sample doc and lets the caller break it. */
function broken(mutate: (d: Loose) => void): unknown {
  const d: Loose = cloneDocument(makeDoc());
  mutate(d);
  return d;
}

const section = (d: Loose) => d.sections[0];
const blockOf = (d: Loose, type: string): Loose => section(d).content.find((b: Loose) => b.type === type);

describe("Schema.validate: accepts", () => {
  it("a document using every built-in node and mark", () => {
    expect(coreSchema.validate(makeDoc())).toEqual([]);
  });

  it("comment and insertion/deletion marks that reference existing entries", () => {
    const d = broken((d) => {
      d.comments["c1"] = { id: "c1", authorId: "u1", createdAt: "2026-01-01T00:00:00Z", body: "hi", resolved: false, replies: [] };
      d.revisions["r1"] = { id: "r1", kind: "insertion", authorId: "u1", createdAt: "2026-01-01T00:00:00Z", status: "pending" };
      const p = blockOf(d, "paragraph");
      p.content.push({ type: "text", text: "x", marks: [{ type: "comment", attrs: { commentId: "c1" } }, { type: "insertion", attrs: { revisionId: "r1" } }] });
    });
    expect(codes(d)).toEqual([]);
  });

  it("accepts negative Word paragraph indents used for hanging/RTL layouts", () => {
    const d = broken((d) => {
      const p = blockOf(d, "paragraph");
      p.attrs = { ...(p.attrs ?? {}), indentRight: -120, firstLineIndent: -240, hangingIndent: -240 };
    });
    expect(coreSchema.validate(d as never)).toEqual([]);
  });

  it("header and footer content with page number nodes", () => {
    const d = broken((d) => {
      section(d).footer = [{ type: "paragraph", id: "f1", content: [{ type: "text", text: "Page " }, { type: "pageNumber" }, { type: "text", text: " of " }, { type: "pageCount" }] }];
    });
    expect(codes(d)).toEqual([]);
  });
});

describe("Schema.validate: reports every issue code", () => {
  it("unsupported-version", () => expect(codes(broken((d) => (d.schemaVersion = 99)))).toEqual(["unsupported-version"]));
  it("malformed: no sections", () => expect(codes(broken((d) => (d.sections = [])))).toContain("malformed"));
  it("malformed: comment key mismatch", () =>
    expect(codes(broken((d) => (d.comments["k"] = { id: "other", authorId: "u", createdAt: "x", body: "", resolved: false, replies: [] })))).toContain("malformed"));
  it("unknown-node", () => expect(codes(broken((d) => blockOf(d, "paragraph").content.push({ type: "mystery" })))).toContain("unknown-node"));
  it("unknown-mark", () =>
    expect(codes(broken((d) => blockOf(d, "paragraph").content.push({ type: "text", text: "x", marks: [{ type: "sparkle" }] })))).toContain("unknown-mark"));
  it("misplaced-node: row directly in section", () =>
    expect(codes(broken((d) => section(d).content.push({ type: "tableRow", id: "zz", content: [] })))).toContain("misplaced-node"));
  it("misplaced-node: block inside paragraph", () =>
    expect(codes(broken((d) => blockOf(d, "paragraph").content.push({ type: "heading", id: "zz", attrs: { level: 1 } })))).toContain("misplaced-node"));
  it("invalid-content: empty list", () =>
    expect(codes(broken((d) => (blockOf(d, "bulletList").content = [])))).toContain("invalid-content"));
  it("invalid-content: empty text node", () =>
    expect(codes(broken((d) => blockOf(d, "paragraph").content.push({ type: "text", text: "" })))).toContain("invalid-content"));
  it("unknown-attr", () => expect(codes(broken((d) => (blockOf(d, "heading").attrs.foo = 1)))).toContain("unknown-attr"));
  it("missing-attr: heading level", () => expect(codes(broken((d) => delete blockOf(d, "heading").attrs.level))).toContain("missing-attr"));
  it("missing-attr: image src", () => expect(codes(broken((d) => delete blockOf(d, "image").attrs.src))).toContain("missing-attr"));
  it("invalid-attr", () => expect(codes(broken((d) => (blockOf(d, "heading").attrs.level = 9)))).toContain("invalid-attr"));
  it("non-json: NaN", () => expect(codes(broken((d) => (blockOf(d, "heading").attrs.align = Number.NaN)))).toContain("non-json"));
  it("non-json: Date instance", () => expect(codes(broken((d) => (blockOf(d, "heading").attrs.align = new Date())))).toContain("non-json"));
  it("non-json: function", () => expect(codes(broken((d) => (blockOf(d, "heading").attrs.align = () => 1)))).toContain("non-json"));
  it("duplicate-id", () =>
    expect(codes(broken((d) => (section(d).content[1].id = section(d).content[0].id)))).toContain("duplicate-id"));
  it("dangling-reference: comment", () =>
    expect(
      codes(broken((d) => blockOf(d, "paragraph").content.push({ type: "text", text: "x", marks: [{ type: "comment", attrs: { commentId: "nope" } }] }))),
    ).toContain("dangling-reference"));
  it("dangling-reference: revision", () =>
    expect(
      codes(broken((d) => blockOf(d, "paragraph").content.push({ type: "text", text: "x", marks: [{ type: "deletion", attrs: { revisionId: "nope" } }] }))),
    ).toContain("dangling-reference"));
  it("duplicate-mark", () =>
    expect(codes(broken((d) => blockOf(d, "paragraph").content.push({ type: "text", text: "x", marks: [{ type: "bold" }, { type: "bold" }] })))).toContain("duplicate-mark"));
  it("invalid-page: negative width", () => expect(codes(broken((d) => (section(d).page.size.width = -1)))).toContain("invalid-page"));
  it("invalid-page: bad orientation", () => expect(codes(broken((d) => (section(d).page.orientation = "sideways")))).toContain("invalid-page"));
  it("invalid-page: missing margin", () => expect(codes(broken((d) => delete section(d).page.margins.left))).toContain("invalid-page"));
  it("marks are rejected inside codeBlock", () => {
    const d = broken((d) => section(d).content.push({ type: "codeBlock", id: "cb", content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }] }));
    expect(codes(d)).toContain("misplaced-node");
  });

  it("issue paths point at the offending node", () => {
    const issues = coreSchema.validate(broken((d) => (blockOf(d, "heading").attrs.level = 9)) as never);
    expect(issues[0]!.path).toBe("sections[0].content[0].attrs.level");
  });
});

describe("Schema.extend (plugin contributions)", () => {
  const callout: NodeSpec = { name: "callout", kind: "block", groups: ["block"], content: { children: "block", allow: ["block"], min: 1 }, attrs: { tone: { default: "info" } } };

  it("lets plugins add node types without mutating the original schema", () => {
    const extended = coreSchema.extend({ nodes: [callout] });
    const doc = broken((d) => section(d).content.push({ type: "callout", id: "co1", content: [{ type: "paragraph", id: "co1p" }] })) as never;
    expect(extended.validate(doc)).toEqual([]);
    expect(coreSchema.validate(doc).map((i) => i.code)).toContain("unknown-node");
    expect(coreSchema.node("callout")).toBeUndefined();
    expect(extended.node("callout")).toBeDefined();
  });

  it("throws on duplicate node or mark names", () => {
    expect(() => coreSchema.extend({ nodes: [{ ...callout, name: "paragraph" }] })).toThrow(/duplicate node spec/);
    expect(() => coreSchema.extend({ marks: [{ name: "bold" }] })).toThrow(/duplicate mark spec/);
    expect(() => Schema.create({ nodes: [callout, callout] })).toThrow(/duplicate/);
  });

  it("allows plugin marks on text", () => {
    const extended = coreSchema.extend({ marks: [{ name: "spoiler" }] });
    const doc = broken((d) => blockOf(d, "paragraph").content.push({ type: "text", text: "x", marks: [{ type: "spoiler" }] })) as never;
    expect(extended.validate(doc)).toEqual([]);
    expect(coreSchema.validate(doc).map((i) => i.code)).toContain("unknown-mark");
  });
});
