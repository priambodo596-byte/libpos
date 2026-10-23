import { describe, expect, it } from "vitest";
import { coreSchema, createDocument, createNodeFactory, defaultPageSetup, parseDocument } from "../src/index";
import { NOW, makeDoc } from "./helpers";

describe("factory", () => {
  it("creates a document that validates against the core schema", () => {
    expect(coreSchema.validate(makeDoc())).toEqual([]);
  });

  it("defaults to a single empty paragraph, A4 portrait, 1-inch margins (twips)", () => {
    const doc = createDocument({ now: NOW });
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]!.content).toHaveLength(1);
    expect(doc.sections[0]!.content[0]!.type).toBe("paragraph");
    expect(doc.sections[0]!.page).toEqual(defaultPageSetup());
    expect(doc.sections[0]!.page.size).toEqual({ width: 11906, height: 16838 });
    expect(doc.sections[0]!.page.margins.top).toBe(1440);
    expect(coreSchema.validate(doc)).toEqual([]);
  });

  it("produces deterministic ids with the sequential generator", () => {
    const a = JSON.stringify(makeDoc());
    const b = JSON.stringify(makeDoc());
    expect(a).toBe(b);
  });

  it("generates unique ids with the default generator", () => {
    const f = createNodeFactory();
    const ids = new Set(Array.from({ length: 500 }, () => f.paragraph("x").id));
    expect(ids.size).toBe(500);
  });

  it("survives a JSON round trip and still validates (plain JSON only)", () => {
    const doc = makeDoc();
    const round = JSON.parse(JSON.stringify(doc)) as unknown;
    expect(round).toEqual(doc);
    const parsed = parseDocument(round);
    expect(parsed.ok).toBe(true);
  });

  it("does not emit undefined-valued keys (would be lost in JSON)", () => {
    const doc = makeDoc();
    const json = JSON.stringify(doc);
    expect(JSON.parse(json)).toStrictEqual(doc);
  });
});

