import { describe, expect, it } from "vitest";
import {
  DocumentVersionError,
  MigrationRegistry,
  SCHEMA_VERSION,
  cloneJson,
  parseDocument,
} from "../src/index";
import { makeDoc } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("parseDocument", () => {
  it("accepts a current-version document unchanged", () => {
    const doc = makeDoc();
    const r = parseDocument(doc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.migrated).toBe(false);
      expect(r.document).toEqual(doc);
      expect(r.document).not.toBe(doc); // cloned, never aliased
    }
  });

  it("rejects documents from a newer schema instead of guessing", () => {
    const r = parseDocument({ ...makeDoc(), schemaVersion: SCHEMA_VERSION + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe("unsupported-version");
  });

  it("rejects a missing or non-integer schemaVersion", () => {
    for (const v of [undefined, "1", 1.5, -1, null]) {
      const r = parseDocument({ ...makeDoc(), schemaVersion: v });
      expect(r.ok).toBe(false);
    }
  });

  it("reports validation issues for structurally broken documents", () => {
    const d: any = makeDoc();
    d.sections[0].content[0].attrs.level = 42;
    const r = parseDocument(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code)).toContain("invalid-attr");
  });
});

describe("migrations", () => {
  // A realistic v0 -> v1 step: v0 documents had no `revisions` map.
  const v0ToV1 = {
    from: 0,
    to: SCHEMA_VERSION,
    migrate(doc: unknown) {
      const d = doc as any;
      return { ...d, schemaVersion: SCHEMA_VERSION, revisions: d.revisions ?? {} };
    },
  };

  function legacyDoc(): any {
    const d: any = makeDoc();
    d.schemaVersion = 0;
    delete d.revisions;
    return d;
  }

  it("upgrades an old document and validates the result", () => {
    const registry = new MigrationRegistry(SCHEMA_VERSION).register(v0ToV1);
    const r = parseDocument(legacyDoc(), { migrations: registry });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.migrated).toBe(true);
      expect(r.document.schemaVersion).toBe(SCHEMA_VERSION);
      expect(r.document.revisions).toEqual({});
    }
  });

  it("never mutates its input", () => {
    const input = legacyDoc();
    const snapshot = JSON.stringify(input);
    parseDocument(input, { migrations: new MigrationRegistry(SCHEMA_VERSION).register(v0ToV1) });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("reports a missing migration path as unsupported-version", () => {
    const r = parseDocument(legacyDoc());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe("unsupported-version");
  });

  it("chains multiple migrations in order", () => {
    const reg = new MigrationRegistry(3)
      .register({ from: 1, to: 2, migrate: (d) => ({ ...(d as object), schemaVersion: 2, a: true }) })
      .register({ from: 2, to: 3, migrate: (d) => ({ ...(d as object), schemaVersion: 3, b: true }) });
    const out = reg.migrate({ schemaVersion: 1 });
    expect(out.applied).toEqual([2, 3]);
    expect(out.document).toMatchObject({ schemaVersion: 3, a: true, b: true });
  });

  it("detects a migration that forgets to set schemaVersion", () => {
    const reg = new MigrationRegistry(1).register({ from: 0, to: 1, migrate: (d) => d });
    expect(() => reg.migrate({ schemaVersion: 0 })).toThrow(DocumentVersionError);
  });

  it("rejects invalid registrations", () => {
    const reg = new MigrationRegistry(2);
    expect(() => reg.register({ from: 2, to: 1, migrate: (d) => d })).toThrow(/increase/);
    reg.register({ from: 0, to: 1, migrate: (d) => d });
    expect(() => reg.register({ from: 0, to: 2, migrate: (d) => d })).toThrow(/already registered/);
  });
});

describe("untrusted input: parseDocument never throws", () => {
  const base = () => JSON.parse(JSON.stringify(makeDoc())) as any;
  const cases: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["number", 5],
    ["string", "x"],
    ["array", []],
    ["empty object", {}],
    ["version only", { schemaVersion: SCHEMA_VERSION }],
    ["sections: [null]", { ...base(), sections: [null] }],
    ["sections: not an array", { ...base(), sections: {} }],
    ["section.content: [null]", (() => { const d = base(); d.sections[0].content = [null]; return d; })()],
    ["section.content not array", (() => { const d = base(); d.sections[0].content = "x"; return d; })()],
    ["section.page missing", (() => { const d = base(); delete d.sections[0].page; return d; })()],
    ["comments: { a: null }", { ...base(), comments: { a: null } }],
    ["revisions: { a: null }", { ...base(), revisions: { a: null } }],
    ["comments: null", { ...base(), comments: null }],
    ["meta: null", { ...base(), meta: null }],
    ["text marks: [null]", (() => { const d = base(); d.sections[0].content[1].content[0].marks = [null]; return d; })()],
    ["mark attrs: null-proto weirdness", (() => { const d = base(); d.sections[0].content[0].attrs = null; return d; })()],
    ["child is a string", (() => { const d = base(); d.sections[0].content[1].content = ["boom"]; return d; })()],
  ];

  for (const [name, input] of cases) {
    it(`handles ${name}`, () => {
      expect(() => parseDocument(input)).not.toThrow();
      expect(parseDocument(input).ok).toBe(false);
    });
  }

  it("reports a throwing schemaVersion getter as an issue", () => {
    const d: any = base();
    Object.defineProperty(d, "schemaVersion", {
      enumerable: true,
      get() {
        throw new Error("unreadable schema version");
      },
    });

    expect(() => parseDocument(d)).not.toThrow();
    const result = parseDocument(d);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({ code: "malformed", path: "" });
      expect(result.issues[0]!.message).toContain("unreadable schema version");
    }
  });

  it("converts custom migration failures into validation issues", () => {
    const registry = new MigrationRegistry(SCHEMA_VERSION).register({
      from: 0,
      to: SCHEMA_VERSION,
      migrate() {
        throw new Error("migration crashed");
      },
    });

    const result = parseDocument({ ...base(), schemaVersion: 0 }, { migrations: registry });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({ code: "malformed", path: "" });
      expect(result.issues[0]!.message).toContain("migration crashed");
    }
  });

  it("handles a cyclic structure without throwing", () => {
    const d: any = base();
    d.sections[0].content[0].attrs.self = d;
    expect(() => parseDocument(d)).not.toThrow();
    const result = parseDocument(d);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.code).toBe("malformed");
      expect(result.issues[0]!.message).toContain("could not be cloned");
    }
  });

  it("reports structures that throw during cloning as issues", () => {
    const d: any = base();
    Object.defineProperty(d.meta, "title", {
      enumerable: true,
      get() {
        throw new Error("unreadable title");
      },
    });

    expect(() => parseDocument(d)).not.toThrow();
    const result = parseDocument(d);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        code: "malformed",
        path: "",
      });
      expect(result.issues[0]!.message).toContain("unreadable title");
    }
  });

  it("handles extremely deep nesting without a stack overflow", () => {
    const d: any = base();
    let node: any = { type: "blockquote", id: "q0", content: [] };
    const root = node;
    for (let i = 1; i < 50_000; i++) {
      const child = { type: "blockquote", id: `q${i}`, content: [] as any[] };
      node.content.push(child);
      node = child;
    }
    d.sections[0].content.push(root);
    expect(() => parseDocument(d)).not.toThrow();
    expect(parseDocument(d).ok).toBe(false);
  });
});

describe("cloneJson", () => {
  it("keeps an own `__proto__` key as data instead of changing the prototype", () => {
    const parsed = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
    const copy: any = cloneJson(parsed);
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(copy.polluted).toBeUndefined();
    expect(Object.keys(copy).sort()).toEqual(["__proto__", "ok"]);
    expect(({} as any).polluted).toBeUndefined();
  });

  it("produces an independent deep copy", () => {
    const src = { a: [1, { b: 2 }] };
    const copy = cloneJson(src);
    (copy.a[1] as any).b = 3;
    expect((src.a[1] as any).b).toBe(2);
  });
});
