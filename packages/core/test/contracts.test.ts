import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CORE_API_VERSION,
  coreSchema,
  parseDocument,
  type CollabConnection,
  type CollaborationAdapter,
  type CommandContext,
  type CommandSpec,
  type ConnectionStatus,
  type DocumentExporter,
  type DocumentImporter,
  type DocumentJSON,
  type EditorEventMap,
  type Operation,
  type OperationType,
  type PluginDefinition,
  type PresenceState,
  type RemoteChange,
  type StorageAdapter,
  type StorageResult,
  type StoredDocument,
  type Transaction,
  type Unsubscribe,
} from "../src/index";
import { NOW, makeDoc } from "./helpers";

// ---------------------------------------------------------------- operations

const allOps: Operation[] = [
  { type: "insert_text", at: { blockId: "b", offset: 0 }, text: "hi", marks: [{ type: "bold" }] },
  { type: "delete_text", blockId: "b", from: 0, to: 2 },
  { type: "format", blockId: "b", from: 0, to: 2, mark: { type: "italic" }, action: "add" },
  { type: "insert_inline", at: { blockId: "b", offset: 1 }, node: { type: "placeholder", attrs: { key: "k" } } },
  { type: "insert_block", parent: { kind: "section", id: "s1", slot: "footer" }, index: 0, node: { type: "paragraph", id: "p9" } },
  { type: "remove_block", id: "p9" },
  { type: "set_attrs", id: "h1", set: { level: 2 }, unset: ["align"] },
  { type: "set_node_type", id: "h1", nodeType: "heading", attrs: { level: 2 } },
  { type: "split_block", id: "b", offset: 1, newId: "b2" },
  { type: "join_blocks", firstId: "b", secondId: "b2" },
  { type: "insert_section", index: 1, section: { id: "s2", page: makeDoc().sections[0]!.page, content: [{ type: "paragraph", id: "q1" }] } },
  { type: "remove_section", id: "s2" },
  { type: "set_page", sectionId: "s1", page: makeDoc().sections[0]!.page },
  { type: "set_meta", set: { title: "New", custom: { k: 1 } } },
  { type: "put_comment", comment: { id: "c1", authorId: "u", createdAt: NOW, body: "x", resolved: false, replies: [] } },
  { type: "remove_comment", id: "c1" },
  { type: "put_revision", revision: { id: "r1", kind: "insertion", authorId: "u", createdAt: NOW, status: "pending" } },
  { type: "set_revision_status", id: "r1", status: "accepted" },
];

/** Compile-time check: every OperationType must be listed here, and nowhere else. */
const covered = {
  insert_text: true,
  delete_text: true,
  format: true,
  insert_inline: true,
  insert_block: true,
  remove_block: true,
  set_attrs: true,
  set_node_type: true,
  split_block: true,
  join_blocks: true,
  insert_section: true,
  remove_section: true,
  set_page: true,
  set_meta: true,
  put_comment: true,
  remove_comment: true,
  put_revision: true,
  set_revision_status: true,
} satisfies Record<OperationType, true>;

/** Compile-time exhaustiveness: adding an operation without handling it breaks this function. */
function target(op: Operation): string {
  switch (op.type) {
    case "insert_text":
    case "insert_inline":
      return op.at.blockId;
    case "delete_text":
    case "format":
      return op.blockId;
    case "insert_block":
      return op.parent.id;
    case "remove_block":
    case "set_attrs":
    case "set_node_type":
    case "split_block":
    case "remove_section":
    case "remove_comment":
    case "set_revision_status":
      return op.id;
    case "join_blocks":
      return op.firstId;
    case "insert_section":
      return op.section.id;
    case "set_page":
      return op.sectionId;
    case "set_meta":
      return "meta";
    case "put_comment":
      return op.comment.id;
    case "put_revision":
      return op.revision.id;
    default: {
      const unreachable: never = op;
      return unreachable;
    }
  }
}

describe("operations contract", () => {
  it("has a sample for every operation type", () => {
    expect(allOps.map((o) => o.type).sort()).toEqual(Object.keys(covered).sort());
    expect(allOps.every((o) => typeof target(o) === "string")).toBe(true);
  });

  it("is plain JSON: a transaction survives JSON round trip unchanged", () => {
    const tr: Transaction = {
      id: "t1",
      ops: allOps,
      selection: { anchor: { blockId: "b", offset: 0 }, head: { blockId: "b", offset: 2 } },
      baseVersion: 4,
      meta: { origin: "test", authorId: "u", timestamp: NOW, addToHistory: false, custom: { a: [1, 2] } },
    };
    expect(JSON.parse(JSON.stringify(tr))).toStrictEqual(tr);
  });

  it("exposes the expected types (compile-time)", () => {
    expectTypeOf<OperationType>().toEqualTypeOf<keyof typeof covered>();
    expectTypeOf<Transaction["ops"]>().toEqualTypeOf<readonly Operation[]>();
    expectTypeOf<EditorEventMap["state:change"]["transaction"]>().toEqualTypeOf<Transaction>();
  });
});

// ---------------------------------------------------------------- storage

class MemoryStorage implements StorageAdapter {
  private readonly docs = new Map<string, { doc: DocumentJSON; rev: number }>();

  async load(id: string): Promise<StorageResult<StoredDocument | null>> {
    const hit = this.docs.get(id);
    if (!hit) return { ok: true, value: null };
    return { ok: true, value: { id, document: structuredClone(hit.doc), revision: String(hit.rev), updatedAt: NOW } };
  }

  async save(id: string, document: DocumentJSON, options?: { expectedRevision?: string | null }): Promise<StorageResult<{ revision: string }>> {
    const hit = this.docs.get(id);
    const expected = options?.expectedRevision;
    if (expected !== undefined) {
      const actual = hit ? String(hit.rev) : null;
      if (expected !== actual) {
        return { ok: false, error: { code: "conflict", message: "stale revision", ...(actual !== null ? { currentRevision: actual } : {}) } };
      }
    }
    const rev = (hit?.rev ?? 0) + 1;
    this.docs.set(id, { doc: structuredClone(document), rev });
    return { ok: true, value: { revision: String(rev) } };
  }
}

describe("storage contract", () => {
  it("can be implemented with optimistic concurrency and reports conflicts as values", async () => {
    const store = new MemoryStorage();
    const doc = makeDoc();

    const first = await store.save("d", doc, { expectedRevision: null });
    expect(first).toEqual({ ok: true, value: { revision: "1" } });

    const dup = await store.save("d", doc, { expectedRevision: null });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatchObject({ code: "conflict", currentRevision: "1" });

    const stale = await store.save("d", doc, { expectedRevision: "0" });
    expect(stale.ok).toBe(false);

    const second = await store.save("d", doc, { expectedRevision: "1" });
    expect(second).toEqual({ ok: true, value: { revision: "2" } });
  });

  it("stored documents round-trip through parseDocument", async () => {
    const store = new MemoryStorage();
    await store.save("d", makeDoc());
    const loaded = await store.load("d");
    expect(loaded.ok && loaded.value !== null).toBe(true);
    if (loaded.ok && loaded.value) {
      const parsed = parseDocument(loaded.value.document);
      expect(parsed.ok).toBe(true);
    }
    const missing = await store.load("nope");
    expect(missing).toEqual({ ok: true, value: null });
  });
});

// ---------------------------------------------------------------- collaboration

class LoopbackHub implements CollaborationAdapter {
  private readonly peers = new Set<LoopbackConnection>();
  async connect(init: { documentId: string; user: { id: string }; localVersion: number }): Promise<CollabConnection> {
    void init;
    const c = new LoopbackConnection(this);
    this.peers.add(c);
    c.status = "connected";
    return c;
  }
  broadcast(from: LoopbackConnection, tr: Transaction): void {
    for (const p of this.peers) if (p !== from) p.deliver({ transactions: [tr], remoteVersion: 1 });
  }
  remove(c: LoopbackConnection): void {
    this.peers.delete(c);
  }
}

class LoopbackConnection implements CollabConnection {
  status: ConnectionStatus = "connecting";
  private remote = new Set<(c: RemoteChange) => void>();
  private statusHandlers = new Set<(s: ConnectionStatus) => void>();
  private presenceHandlers = new Set<(p: readonly PresenceState[]) => void>();
  constructor(private readonly hub: LoopbackHub) {}
  sendLocal(tr: Transaction): void {
    this.hub.broadcast(this, tr);
  }
  deliver(change: RemoteChange): void {
    for (const h of this.remote) h(change);
  }
  onRemote(h: (c: RemoteChange) => void): Unsubscribe {
    this.remote.add(h);
    return () => void this.remote.delete(h);
  }
  onStatus(h: (s: ConnectionStatus) => void): Unsubscribe {
    this.statusHandlers.add(h);
    return () => void this.statusHandlers.delete(h);
  }
  setPresence(p: PresenceState): void {
    for (const h of this.presenceHandlers) h([p]);
  }
  onPresence(h: (p: readonly PresenceState[]) => void): Unsubscribe {
    this.presenceHandlers.add(h);
    return () => void this.presenceHandlers.delete(h);
  }
  async disconnect(): Promise<void> {
    this.status = "disconnected";
    for (const h of this.statusHandlers) h("disconnected");
    this.hub.remove(this);
  }
}

describe("collaboration contract", () => {
  it("can be implemented by a transport that knows nothing about the editor", async () => {
    const hub = new LoopbackHub();
    const a = await hub.connect({ documentId: "d", user: { id: "a" }, localVersion: 0 });
    const b = await hub.connect({ documentId: "d", user: { id: "b" }, localVersion: 0 });
    const received: RemoteChange[] = [];
    const off = b.onRemote((c) => received.push(c));

    const tr: Transaction = { id: "t1", ops: [allOps[0]!], meta: { origin: "test" } };
    a.sendLocal(tr);
    expect(received).toHaveLength(1);
    expect(received[0]!.transactions[0]).toEqual(tr);

    off();
    a.sendLocal(tr);
    expect(received).toHaveLength(1);

    const statuses: ConnectionStatus[] = [];
    b.onStatus((s) => statuses.push(s));
    await b.disconnect();
    expect(statuses).toEqual(["disconnected"]);
    a.sendLocal(tr); // b is gone; must not throw or deliver
    expect(received).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- commands, plugins, conversion

describe("command and plugin contracts", () => {
  it("a command is a pure function from state to a serialisable transaction", () => {
    const retitle: CommandSpec<{ title: string }> = {
      id: "doc.retitle",
      title: "Retitle document",
      canRun: (_ctx, args) => args.title.length > 0,
      run: (ctx: CommandContext, args) => ({
        ok: true,
        transaction: { id: "t", ops: [{ type: "set_meta", set: { title: args.title } }], meta: { origin: "command:doc.retitle" }, baseVersion: ctx.state.version },
      }),
    };
    const state = { document: makeDoc(), selection: null, schema: coreSchema, version: 7 };
    const out = retitle.run({ state }, { title: "Hello" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.transaction?.baseVersion).toBe(7);
      expect(JSON.parse(JSON.stringify(out.transaction))).toStrictEqual(out.transaction);
    }
    expect(retitle.canRun?.({ state }, { title: "" })).toBe(false);
  });

  it("a plugin definition can contribute schema and declare permissions and compatibility", () => {
    const plugin = {
      manifest: { name: "convetlib-callout", version: "0.1.0", engines: { core: "^0.1.0" }, permissions: ["document:write", "commands:register"] },
      schema: { nodes: [{ name: "callout", kind: "block", groups: ["block"], content: { children: "block", allow: ["block"], min: 1 } }] },
      activate: () => {},
      beforeDispatch: () => ({ action: "allow" }),
    } as const satisfies PluginDefinition;

    expect(plugin.manifest.engines.core).toBe("^0.1.0");
    expect(CORE_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const extended = coreSchema.extend(plugin.schema);
    expect(extended.node("callout")?.kind).toBe("block");
  });
});

describe("conversion contract", () => {
  it("importers/exporters return warnings instead of silently dropping content", async () => {
    const importer: DocumentImporter = {
      format: "json",
      async import(data) {
        try {
          const parsed = parseDocument(JSON.parse(new TextDecoder().decode(data)));
          if (!parsed.ok) return { ok: false, error: { code: "invalid-input", message: parsed.issues[0]!.message } };
          return { ok: true, document: parsed.document, warnings: [{ code: "approximation", message: "demo warning", feature: "demo" }] };
        } catch (e) {
          return { ok: false, error: { code: "invalid-input", message: String(e) } };
        }
      },
    };
    const exporter: DocumentExporter = {
      format: "json",
      mimeType: "application/json",
      async export(document) {
        return { ok: true, data: new TextEncoder().encode(JSON.stringify(document)), warnings: [] };
      },
    };

    const doc = makeDoc();
    const exported = await exporter.export(doc);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const imported = await importer.import(exported.data);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.document).toEqual(doc);
      expect(imported.warnings[0]?.code).toBe("approximation");
    }
    const bad = await importer.import(new TextEncoder().encode("not json"));
    expect(bad.ok).toBe(false);
  });
});
