import { describe, expect, it } from "vitest";
import { createDocument, createEditor, createNodeFactory, createSequentialIdGenerator, type Transaction } from "../src/index";

const tx = (ops: Transaction["ops"], id = "tx-1"): Transaction => ({ id, ops, meta: { origin: "test", timestamp: "2026-01-01T00:00:00.000Z" } });

describe("createEditor engine", () => {
  it("creates a validated immutable state and emits state:change after dispatch", async () => {
    const doc = createDocument({ id: "doc", now: "2026-01-01T00:00:00.000Z", ids: createSequentialIdGenerator() });
    const editor = await createEditor({ document: doc, now: () => "2026-01-02T00:00:00.000Z" });
    const block = editor.state.document.sections[0]!.content[0]!;
    let changes = 0;
    editor.on("state:change", () => changes++);
    const result = editor.dispatch(tx([{ type: "insert_text", at: { blockId: block.id, offset: 0 }, text: "Hello" }]));
    expect(result.ok).toBe(true);
    expect(editor.state.version).toBe(1);
    expect(editor.state.document.sections[0]!.content[0]!.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(changes).toBe(1);
    expect(Object.isFrozen(editor.state.document)).toBe(true);
    await editor.destroy();
  });

  it("applies transactions atomically when a later operation fails", async () => {
    const editor = await createEditor();
    const block = editor.state.document.sections[0]!.content[0]!;
    const result = editor.dispatch(tx([
      { type: "insert_text", at: { blockId: block.id, offset: 0 }, text: "must rollback" },
      { type: "remove_block", id: "missing" },
    ]));
    expect(result.ok).toBe(false);
    expect(editor.state.version).toBe(0);
    expect(editor.state.document.sections[0]!.content[0]!.content ?? []).toEqual([]);
    await editor.destroy();
  });

  it("rejects writes when read-only and rejects stale transactions", async () => {
    const editor = await createEditor({ editable: false });
    const block = editor.state.document.sections[0]!.content[0]!;
    expect(editor.dispatch(tx([{ type: "insert_text", at: { blockId: block.id, offset: 0 }, text: "x" }])).ok).toBe(false);
    editor.setEditable(true);
    expect(editor.dispatch({ ...tx([{ type: "insert_text", at: { blockId: block.id, offset: 0 }, text: "x" }]), baseVersion: 10 }).ok).toBe(false);
    await editor.destroy();
  });

  it("runs registered commands through the dispatch path", async () => {
    const editor = await createEditor();
    const block = editor.state.document.sections[0]!.content[0]!;
    editor.commands.register({ id: "test.insert", run: () => ({ ok: true, transaction: tx([{ type: "insert_text", at: { blockId: block.id, offset: 0 }, text: "cmd" }]) }) });
    expect(editor.commands.can("test.insert")).toBe(true);
    expect(editor.commands.execute("test.insert")).toEqual({ ok: true, dispatched: true });
    expect(editor.state.document.sections[0]!.content[0]!.content).toEqual([{ type: "text", text: "cmd" }]);
    await editor.destroy();
  });

  it("registers and cleans up plugins with status events", async () => {
    const editor = await createEditor();
    const statuses: string[] = [];
    editor.on("plugin:status", e => statuses.push(e.status));
    const result = await editor.plugins.register({ manifest: { name: "test-plugin", version: "1.0.0", engines: { core: "^0.1.0" }, permissions: [] }, activate: () => {} });
    expect(result.ok).toBe(true);
    expect(editor.plugins.get("test-plugin")?.status).toBe("active");
    expect(await editor.plugins.unregister("test-plugin")).toBe(true);
    expect(statuses).toEqual(["activating", "active", "deactivating", "inactive"]);
    await editor.destroy();
  });

  it("rejects a transaction through a plugin hook without changing state", async () => {
    const editor = await createEditor({ plugins: [{ manifest: { name: "guard", version: "1.0.0", engines: { core: "^0.1.0" }, permissions: [] }, beforeDispatch: () => ({ action: "reject", reason: "blocked" }) }] });
    const block = editor.state.document.sections[0]!.content[0]!;
    const result = editor.dispatch(tx([{ type: "insert_text", at: { blockId: block.id, offset: 0 }, text: "x" }]));
    expect(result).toMatchObject({ ok: false, error: { code: "rejected-by-plugin", message: "blocked" } });
    expect(editor.state.version).toBe(0);
    await editor.destroy();
  });

  it("applies and removes plugin schema extensions at runtime", async () => {
    const editor = await createEditor();
    const plugin = { manifest: { name: "custom-node", version: "1.0.0", engines: { core: "^0.1.0" }, permissions: [] }, schema: { nodes: [{ name: "callout", kind: "block" as const, groups: ["block"], content: { children: "none" as const } }] } };
    expect((await editor.plugins.register(plugin)).ok).toBe(true);
    const ids = createSequentialIdGenerator("custom-");
    const f = createNodeFactory(ids);
    const replacement = createDocument({ title: "Plugin node", ids, content: [f.block("callout")] });
    expect(editor.replaceDocument(replacement).ok).toBe(true);
    expect(await editor.plugins.unregister("custom-node")).toBe(true);
    expect(editor.replaceDocument(replacement).ok).toBe(false);
    await editor.destroy();
  });

  it("undoes and redoes document changes without changing history recursively", async () => {
    const editor = await createEditor();
    const block = editor.state.document.sections[0]!.content[0]!;
    const transaction = (text: string, id: string): Transaction => ({ id, ops: [{ type: "insert_text", at: { blockId: block.id, offset: 0 }, text }], meta: { origin: "test", timestamp: "2026-01-01T00:00:00.000Z" } });
    expect(editor.history.canUndo).toBe(false);
    expect(editor.dispatch(transaction("A", "history-a")).ok).toBe(true);
    expect(editor.history.canUndo).toBe(true);
    expect(editor.state.document.sections[0]!.content[0]!.content).toEqual([{ type: "text", text: "A" }]);
    expect(editor.history.undo()).toBe(true);
    expect(editor.state.document.sections[0]!.content[0]!.content ?? []).toEqual([]);
    expect(editor.history.canRedo).toBe(true);
    expect(editor.history.redo()).toBe(true);
    expect(editor.state.document.sections[0]!.content[0]!.content).toEqual([{ type: "text", text: "A" }]);
    expect(editor.history.canUndo).toBe(true);
    await editor.destroy();
  });

  it("clears redo history after a new edit and resets history on document replacement", async () => {
    const editor = await createEditor();
    const block = editor.state.document.sections[0]!.content[0]!;
    const tx = (text: string, id: string): Transaction => ({ id, ops: [{ type: "insert_text", at: { blockId: block.id, offset: 0 }, text }], meta: { origin: "test", timestamp: "2026-01-01T00:00:00.000Z" } });
    editor.dispatch(tx("A", "a")); editor.history.undo();
    expect(editor.history.canRedo).toBe(true);
    editor.dispatch(tx("B", "b"));
    expect(editor.history.canRedo).toBe(false);
    expect(editor.replaceDocument(createDocument({ title: "New document" })).ok).toBe(true);
    expect(editor.history.canUndo).toBe(false);
    expect(editor.history.canRedo).toBe(false);
    await editor.destroy();
  });

  it("does not record remote or explicitly non-history transactions", async () => {
    const editor = await createEditor();
    const block = editor.state.document.sections[0]!.content[0]!;
    const base = { id: "no-history", ops: [{ type: "insert_text" as const, at: { blockId: block.id, offset: 0 }, text: "X" }], meta: { origin: "test", timestamp: "2026-01-01T00:00:00.000Z", addToHistory: false } };
    expect(editor.dispatch(base).ok).toBe(true);
    expect(editor.history.canUndo).toBe(false);
    await editor.destroy();
  });

  it("replaces the whole document only after schema validation", async () => {
    const editor = await createEditor();
    const bad = { ...createDocument(), schemaVersion: 999 };
    expect(editor.replaceDocument(bad).ok).toBe(false);
    expect(editor.state.version).toBe(0);
    expect(editor.replaceDocument(createDocument({ title: "Replacement" })).ok).toBe(true);
    expect(editor.state.document.meta.title).toBe("Replacement");
    await editor.destroy();
  });
});
