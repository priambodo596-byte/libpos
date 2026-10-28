import { cloneJson, createDocument, defaultIdGenerator, parseDocument, coreSchema, type DocumentJSON, type BlockNode, type Inline, type Mark, type IdGenerator } from "../model";
import type { Editor, EditorOptions, EditorState, DispatchResult, DispatchError, ReplaceDocumentResult } from "../contracts/editor";
import type { Transaction, Operation, ParentRef, Selection } from "../contracts/operations";
import type { CommandRegistry, CommandSpec, CommandOutcome, CommandResult } from "../contracts/commands";
import type { EditorEventMap, EditorEventName, EventHandler, Unsubscribe } from "../contracts/events";
import type { PluginDefinition, PluginHost, PluginInfo, PluginContext, PluginLogger, Permission, PluginRegistrationResult, PluginStatus, TransactionHookResult } from "../contracts/plugin";
import type { CollabConnection } from "../contracts/collaboration";
import type { Schema } from "../model/schema";
import { CORE_API_VERSION } from "../contracts/version";


const isText = (x: Inline): x is import("../model").TextNode => x.type === "text" && typeof (x as { text?: unknown }).text === "string";
const errText = (e: unknown) => e instanceof Error ? e.message : String(e);
function freezeDeep<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) freezeDeep((v as Record<string, unknown>)[k]);
  }
  return v;
}
class Events {
  private map = new Map<EditorEventName, Set<(p: never) => void>>();
  on<K extends EditorEventName>(name: K, fn: EventHandler<K>): Unsubscribe {
    const s = this.map.get(name) ?? new Set(); s.add(fn as (p: never) => void); this.map.set(name, s);
    return () => { s.delete(fn as (p: never) => void); if (!s.size) this.map.delete(name); };
  }
  once<K extends EditorEventName>(name: K, fn: EventHandler<K>): Unsubscribe {
    let off: Unsubscribe = () => {}; off = this.on(name, p => { off(); fn(p); }); return off;
  }
  emit<K extends EditorEventName>(name: K, p: EditorEventMap[K]): void {
    for (const f of [...(this.map.get(name) ?? [])]) try { (f as (v: EditorEventMap[K]) => void)(p); }
    catch (error) { if (name !== "error") this.emit("error", { source: "event-handler", error }); }
  }
  clear() { this.map.clear(); }
}
function blockChildren(items: Array<BlockNode | Inline> | undefined): BlockNode[] {
  const xs = items ?? [];
  // Container content is already the mutable child array. Preserve its identity so
  // nested remove/join/split operations mutate the actual document tree.
  return xs.every((x) => typeof (x as BlockNode).id === "string") ? xs as BlockNode[] : [];
}
function findBlock(doc: DocumentJSON, id: string): BlockNode | undefined {
  const scan = (list: BlockNode[] | undefined): BlockNode | undefined => {
    for (const b of list ?? []) { if (b.id === id) return b; const found = scan(blockChildren(b.content)); if (found) return found; }
    return undefined;
  };
  for (const s of doc.sections) { for (const slot of ["content", "header", "footer", "firstPageHeader", "firstPageFooter", "evenPageHeader", "evenPageFooter"] as const) { const b = scan(s[slot]); if (b) return b; } }
  return undefined;
}
function findParent(doc: DocumentJSON, id: string): { list: BlockNode[]; index: number } | undefined {
  const scan = (list: BlockNode[] | undefined): { list: BlockNode[]; index: number } | undefined => {
    if (!list) return undefined;
    const i = list.findIndex(b => b.id === id); if (i >= 0) return { list, index: i };
    for (const b of list) { const found = scan(blockChildren(b.content)); if (found) return found; } return undefined;
  };
  for (const s of doc.sections) { for (const slot of ["content", "header", "footer", "firstPageHeader", "firstPageFooter", "evenPageHeader", "evenPageFooter"] as const) { const found = scan(s[slot]); if (found) return found; } }
  return undefined;
}
function parentList(doc: DocumentJSON, p: ParentRef): BlockNode[] | undefined {
  if (p.kind === "node") { const b = findBlock(doc, p.id); if (!b) return undefined; if (!b.content) b.content = []; return b.content as BlockNode[]; }
  const s = doc.sections.find(x => x.id === p.id); if (!s) return undefined;
  if (p.slot === "header") return s.header ?? (s.header = []);
  if (p.slot === "footer") return s.footer ?? (s.footer = []);
  const slot = p.slot ?? "content";
  if (slot === "content") return s.content;
  return s[slot] ?? (s[slot] = []);
}
function inlineLen(items: Inline[]) { return items.reduce((n, x) => n + (isText(x) ? x.text.length : 1), 0); }
function split(items: Inline[], offset: number): [Inline[], Inline[]] {
  const left: Inline[] = [], right: Inline[] = []; let pos = 0, rightSide = false;
  for (const x of items) {
    const len = isText(x) ? x.text.length : 1;
    if (rightSide) { right.push(x); continue; }
    if (offset >= pos + len) { left.push(x); pos += len; continue; }
    if (offset <= pos) { right.push(x); rightSide = true; continue; }
    const n = offset - pos;
    if (isText(x)) { if (n) left.push({ ...x, text: x.text.slice(0, n) }); if (n < x.text.length) right.push({ ...x, text: x.text.slice(n) }); }
    else left.push(x);
    rightSide = true; pos += len;
  }
  return [left, right];
}
function replaceText(b: BlockNode, from: number, to: number, text: string | null, marks?: readonly Mark[]): boolean {
  const items = (b.content ?? []) as Inline[];
  if (items.some(x => typeof (x as BlockNode).id === "string") || from < 0 || to < from || to > inlineLen(items)) return false;
  const [left] = split(items, from); const [, right] = split(items, to);
  b.content = [...left, ...(text ? [{ type: "text", text, ...(marks?.length ? { marks: cloneJson([...marks]) } : {}) } as Inline] : []), ...right];
  return true;
}
function applyOp(doc: DocumentJSON, op: Operation): boolean {
  switch (op.type) {
    case "insert_text": { const b = findBlock(doc, op.at.blockId); return !!b && replaceText(b, op.at.offset, op.at.offset, op.text, op.marks); }
    case "delete_text": { const b = findBlock(doc, op.blockId); return !!b && replaceText(b, op.from, op.to, null); }
    case "format": {
      const b = findBlock(doc, op.blockId); if (!b) return false;
      const xs = (b.content ?? []) as Inline[]; if (xs.some(x => typeof (x as BlockNode).id === "string") || op.from < 0 || op.to < op.from || op.to > inlineLen(xs)) return false;
      const out: Inline[] = []; let pos = 0;
      for (const x of xs) {
        if (!isText(x)) { out.push(x); pos++; continue; }
        const start = pos, end = pos + x.text.length; pos = end;
        if (end <= op.from || start >= op.to) { out.push(x); continue; }
        const a = Math.max(0, op.from - start), z = Math.min(x.text.length, op.to - start);
        if (a) out.push({ ...x, text: x.text.slice(0, a) });
        const old = x.marks ?? []; const ms = op.action === "add" ? [...old.filter(m => m.type !== op.mark.type), cloneJson(op.mark)] : old.filter(m => m.type !== op.mark.type);
        if (z > a) out.push({ type: "text", text: x.text.slice(a, z), ...(ms.length ? { marks: ms } : {}) });
        if (z < x.text.length) out.push({ ...x, text: x.text.slice(z) });
      }
      b.content = out; return true;
    }
    case "insert_inline": { const b = findBlock(doc, op.at.blockId); if (!b) return false; const xs = (b.content ?? []) as Inline[]; if (xs.some(x => typeof (x as BlockNode).id === "string") || op.at.offset < 0 || op.at.offset > inlineLen(xs)) return false; const [l, r] = split(xs, op.at.offset); b.content = [...l, cloneJson(op.node), ...r]; return true; }
    case "insert_block": { const xs = parentList(doc, op.parent); if (!xs || op.index < 0 || op.index > xs.length || !Number.isInteger(op.index)) return false; xs.splice(op.index, 0, cloneJson(op.node)); return true; }
    case "remove_block": { const p = findParent(doc, op.id); if (!p) return false; p.list.splice(p.index, 1); return true; }
    case "set_attrs": { const b = findBlock(doc, op.id); if (!b) return false; const attrs = { ...(b.attrs ?? {}), ...(op.set ? cloneJson(op.set) : {}) }; for (const k of op.unset ?? []) delete attrs[k]; b.attrs = attrs; return true; }
    case "set_node_type": { const b = findBlock(doc, op.id); if (!b || !["paragraph", "heading", "blockquote", "codeBlock"].includes(op.nodeType) || (b.content ?? []).some(x => typeof (x as BlockNode).id === "string")) return false; b.type = op.nodeType; b.attrs = op.attrs ? cloneJson(op.attrs) : {}; return true; }
    case "split_block": { const b = findBlock(doc, op.id), p = findParent(doc, op.id); if (!b || !p || (b.content ?? []).some(x => typeof (x as BlockNode).id === "string")) return false; const xs = (b.content ?? []) as Inline[]; if (op.offset < 0 || op.offset > inlineLen(xs)) return false; const [l, r] = split(xs, op.offset); b.content = l; p.list.splice(p.index + 1, 0, { ...cloneJson(b), id: op.newId, content: r }); return true; }
    case "join_blocks": { const a = findParent(doc, op.firstId), b = findParent(doc, op.secondId), x = findBlock(doc, op.firstId), y = findBlock(doc, op.secondId); if (!a || !b || !x || !y || a.list !== b.list || b.index !== a.index + 1) return false; x.content = [...(x.content ?? []), ...(y.content ?? [])]; a.list.splice(b.index, 1); return true; }
    case "insert_section": if (!Number.isInteger(op.index) || op.index < 0 || op.index > doc.sections.length) return false; doc.sections.splice(op.index, 0, cloneJson(op.section)); return true;
    case "remove_section": { if (doc.sections.length <= 1) return false; const i = doc.sections.findIndex(s => s.id === op.id); if (i < 0) return false; doc.sections.splice(i, 1); return true; }
    case "set_page": { const s = doc.sections.find(x => x.id === op.sectionId); if (!s) return false; s.page = cloneJson(op.page); return true; }
    case "set_meta": Object.assign(doc.meta, cloneJson(op.set)); return true;
    case "put_comment": doc.comments[op.comment.id] = cloneJson(op.comment); return true;
    case "remove_comment": if (!doc.comments[op.id]) return false; delete doc.comments[op.id]; return true;
    case "put_revision": doc.revisions[op.revision.id] = cloneJson(op.revision); return true;
    case "set_revision_status": { const r = doc.revisions[op.id]; if (!r) return false; r.status = op.status; return true; }
    default: return false;
  }
}
class Commands implements CommandRegistry {
  private items = new Map<string, CommandSpec<any>>();
  constructor(private state: () => EditorState, private dispatch: (t: Transaction) => DispatchResult) {}
  register<A = unknown>(s: CommandSpec<A>): Unsubscribe { if (!s.id || this.items.has(s.id)) throw new Error(`Command already registered or invalid: ${s.id}`); this.items.set(s.id, s); return () => { if (this.items.get(s.id) === s) this.items.delete(s.id); }; }
  has(id: string) { return this.items.has(id); }
  list() { return [...this.items.values()].map(s => ({ id: s.id, ...(s.title ? { title: s.title } : {}) })); }
  can(id: string, args?: unknown) { const s = this.items.get(id); if (!s) return false; try { return s.canRun ? s.canRun({ state: this.state() }, args) : true; } catch { return false; } }
  execute(id: string, args?: unknown): CommandResult { const s = this.items.get(id); if (!s) return { ok: false, reason: `Unknown command: ${id}` }; try { const c = { state: this.state() }; if (s.canRun && !s.canRun(c, args)) return { ok: false, reason: "Command cannot run in current state" }; const o: CommandOutcome = s.run(c, args); if (!o.ok) return o; if (!o.transaction) return { ok: true, dispatched: false }; const r = this.dispatch(o.transaction); return r.ok ? { ok: true, dispatched: true } : { ok: false, reason: r.error.message }; } catch (e) { return { ok: false, reason: errText(e) }; } }
  clear() { this.items.clear(); }
}
interface PluginRec { def: PluginDefinition; status: PluginStatus; error?: string; offs: Unsubscribe[]; }
class Plugins implements PluginHost {
  private recs = new Map<string, PluginRec>();
  private schemaNow: Schema;
  constructor(private editor: () => Editor, private baseSchema: Schema, private statusEvent: (name: string, status: PluginStatus, error?: string) => void, private log: PluginLogger, private updateSchema: (schema: Schema) => void) { this.schemaNow = baseSchema; }
  get schema() { return this.schemaNow; }
  get(name: string): PluginInfo | undefined { const r = this.recs.get(name); return r ? { manifest: r.def.manifest, status: r.status, ...(r.error ? { error: r.error } : {}) } : undefined; }
  list(): readonly PluginInfo[] { return [...this.recs.keys()].map(n => this.get(n)!); }
  async register(def: PluginDefinition): Promise<PluginRegistrationResult> {
    const m = def?.manifest;
    if (!m || !/^[a-z0-9][a-z0-9._-]*$/.test(m.name) || !/^\d+\.\d+\.\d+/.test(m.version) || !m.engines?.core || !Array.isArray(m.permissions)) return { ok: false, code: "invalid-manifest", message: "Invalid plugin manifest" };
    if (this.recs.has(m.name)) return { ok: false, code: "duplicate-plugin", message: `Plugin "${m.name}" already registered` };
    if (!satisfies(m.engines.core, CORE_API_VERSION)) return { ok: false, code: "incompatible-core", message: `Core API ${CORE_API_VERSION} does not satisfy ${m.engines.core}` };
    for (const [name, range] of Object.entries(m.dependencies ?? {})) { const dep = this.recs.get(name); if (!dep) return { ok: false, code: "missing-dependency", message: `Missing dependency ${name}` }; if (!satisfies(range, dep.def.manifest.version)) return { ok: false, code: "incompatible-dependency", message: `Dependency ${name} does not satisfy ${range}` }; }
    let next = this.schemaNow; try { if (def.schema) next = next.extend(def.schema); } catch (e) { return { ok: false, code: "schema-conflict", message: errText(e) }; }
    const rec: PluginRec = { def, status: "registered", offs: [] }; this.recs.set(m.name, rec); this.set(m.name, rec, "activating");
    const ed = this.editor(), perms = new Set<Permission>(m.permissions);
    const need = (p: Permission) => { if (!perms.has(p)) throw new Error(`permission-denied: ${p}`); };
    const api = Object.freeze({
      get state() { need("document:read"); return ed.state; },
      dispatch: (tx: Transaction) => { need("document:write"); return ed.dispatch(tx); },
      on: (n: EditorEventName, fn: EventHandler<any>) => { need("events:subscribe"); const off = ed.on(n as any, fn as any); rec.offs.push(off); return off; },
      once: (n: EditorEventName, fn: EventHandler<any>) => { need("events:subscribe"); const off = ed.once(n as any, fn as any); rec.offs.push(off); return off; },
      commands: Object.freeze({ register: (s: CommandSpec<any>) => { need("commands:register"); const off = ed.commands.register(s); rec.offs.push(off); return off; }, has: (id: string) => ed.commands.has(id), list: () => ed.commands.list(), can: (id: string, a?: unknown) => ed.commands.can(id, a), execute: (id: string, a?: unknown) => { need("commands:register"); return ed.commands.execute(id, a); } }),
    });
    const ctx: PluginContext = { manifest: m, editor: api, logger: this.log, onDispose: fn => rec.offs.push(fn) };
    try { await def.activate?.(ctx); this.schemaNow = next; this.updateSchema(next); this.set(m.name, rec, "active"); return { ok: true, info: this.get(m.name)! }; }
    catch (e) { rec.error = errText(e); this.set(m.name, rec, "failed", rec.error); for (const off of rec.offs.splice(0).reverse()) try { off(); } catch {} return { ok: false, code: "activation-failed", message: rec.error }; }
  }
  async unregister(name: string) { const r = this.recs.get(name); if (!r) return false; this.set(name, r, "deactivating"); try { await r.def.deactivate?.(); } catch (e) { this.log.error("Plugin deactivation failed", e); } for (const off of r.offs.splice(0).reverse()) try { off(); } catch (e) { this.log.error("Plugin cleanup failed", e); } this.recs.delete(name); this.schemaNow = this.baseSchema; for (const x of this.recs.values()) if (x.def.schema) try { this.schemaNow = this.schemaNow.extend(x.def.schema); } catch (e) { this.log.error("Schema rebuild failed", e); } this.updateSchema(this.schemaNow); this.statusEvent(name, "inactive"); return true; }
  async destroy() { for (const n of [...this.recs.keys()].reverse()) await this.unregister(n); }
  private set(n: string, r: PluginRec, s: PluginStatus, error?: string) { r.status = s; if (error === undefined) delete r.error; else r.error = error; this.statusEvent(n, s, error); }
}
function satisfies(range: string, version: string) { if (range === "*" || range === version) return true; const v = version.split(".").map(Number), m = range.match(/^(\^|~)?(\d+)\.(\d+)\.(\d+)/); if (!m) return false; const b = [Number(m[2] ?? NaN), Number(m[3] ?? NaN), Number(m[4] ?? NaN)]; if (!(m[1] ?? "")) return v.every((x, i) => x === b[i]); if (m[1] === "~") return (v[0] ?? NaN) === (b[0] ?? NaN) && (v[1] ?? NaN) === (b[1] ?? NaN) && (v[2] ?? NaN) >= (b[2] ?? NaN); return (v[0] ?? NaN) === (b[0] ?? NaN) && ((v[1] ?? NaN) > (b[1] ?? NaN) || (v[1] ?? NaN) === (b[1] ?? NaN) && (v[2] ?? NaN) >= (b[2] ?? NaN)); }

export async function createEditor(options: EditorOptions = {}): Promise<Editor> {
  const ids = options.ids ?? defaultIdGenerator, now = options.now ?? (() => new Date().toISOString());
  const parsed = parseDocument(options.document ?? createDocument({ ids, now: now() }));
  if (!parsed.ok) throw new Error(`Invalid initial document: ${parsed.issues.map(x => `${x.path}: ${x.message}`).join("; ")}`);
  let docValue = parsed.document, version = 0, selection: Selection | null = null, destroyed = false, editable = options.editable ?? true;
  type HistoryEntry = { document: DocumentJSON; selection: Selection | null };
  const undoStack: HistoryEntry[] = [], redoStack: HistoryEntry[] = [];
  const historyLimit = 200;
  const captureHistory = (): HistoryEntry => ({ document: cloneJson(docValue), selection: selection ? cloneJson(selection) : null });
  let schema = options.schema ?? coreSchema; const events = new Events(); let connection: CollabConnection | undefined; const collabOffs: Unsubscribe[] = [];
  const logger: PluginLogger = { debug() {}, info() {}, warn() {}, error(message, data) { events.emit("error", { source: "plugin", error: { message, data } }); } };
  const state = (): EditorState => freezeDeep({ document: docValue, selection, schema, version });
  let current = state(); const statusEvent = (name: string, status: PluginStatus, error?: string) => events.emit("plugin:status", { name, status, ...(error ? { error } : {}) });
  let plugins!: Plugins; let ed!: Editor;
  const commands = new Commands(() => current, tx => ed.dispatch(tx));
  const restoreHistory = (entry: HistoryEntry, origin: "history:undo" | "history:redo"): boolean => {
    if (destroyed || !editable) return false;
    const previous = current;
    docValue = cloneJson(entry.document); selection = entry.selection ? cloneJson(entry.selection) : null;
    docValue.meta.updatedAt = now(); version++; current = state();
    const transaction: Transaction = freezeDeep({ id: ids(), ops: [], selection, meta: { origin, timestamp: now(), addToHistory: false } });
    events.emit("state:change", { previous, state: current, transaction });
    return true;
  };
  const history = {
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    undo() { if (!editable || destroyed || !undoStack.length) return false; redoStack.push(captureHistory()); const entry = undoStack.pop()!; return restoreHistory(entry, "history:undo"); },
    redo() { if (!editable || destroyed || !redoStack.length) return false; undoStack.push(captureHistory()); const entry = redoStack.pop()!; return restoreHistory(entry, "history:redo"); },
    clear() { undoStack.length = 0; redoStack.length = 0; },
  };
  ed = {
    get state() { return current; }, get editable() { return editable; }, get history() { return history; }, commands, get plugins() { return plugins; },
    on: events.on.bind(events) as Editor["on"], once: events.once.bind(events) as Editor["once"],
    dispatch(tx: Transaction): DispatchResult {
      const reject = (error: DispatchError): DispatchResult => { events.emit("transaction:rejected", { transaction: tx, error }); return { ok: false, error }; };
      if (destroyed) return reject({ code: "destroyed", message: "Editor has been destroyed" });
      if (!editable && tx?.meta?.origin !== "collab:remote") return reject({ code: "read-only", message: "Editor is read-only" });
      if (!tx || !Array.isArray(tx.ops) || !tx.meta || typeof tx.id !== "string") return reject({ code: "invalid-operation", message: "Invalid transaction shape" });
      if (tx.baseVersion !== undefined && tx.baseVersion !== version) return reject({ code: "invalid-operation", message: `Stale base version ${tx.baseVersion}; current is ${version}` });
      let nextTx: Transaction; try { nextTx = cloneJson(tx); } catch (e) { return reject({ code: "invalid-operation", message: errText(e) }); }
      for (const info of plugins.list()) {
        const rec = (plugins as any).recs.get(info.manifest.name) as PluginRec | undefined;
        if (!rec || rec.status !== "active" || !rec.def.beforeDispatch) continue;
        try { const result: TransactionHookResult = rec.def.beforeDispatch(nextTx, current); if (result.action === "reject") return reject({ code: "rejected-by-plugin", message: result.reason }); if (result.action === "replace") nextTx = cloneJson(result.transaction); }
        catch (e) { events.emit("error", { source: `plugin:${info.manifest.name}:beforeDispatch`, error: e }); return reject({ code: "rejected-by-plugin", message: errText(e) }); }
      }
      const draft = cloneJson(docValue);
      for (let i = 0; i < nextTx.ops.length; i++) if (!applyOp(draft, nextTx.ops[i]!)) return reject({ code: "invalid-operation", message: `Operation ${i} (${nextTx.ops[i]?.type}) could not be applied`, opIndex: i });
      draft.meta.updatedAt = nextTx.meta.timestamp ?? now();
      const issues = schema.validate(draft); if (issues.length) return reject({ code: "schema-violation", message: issues.slice(0, 3).map(x => `${x.path}: ${x.message}`).join("; ") });
      const previous = current;
      if (nextTx.ops.length > 0 && nextTx.meta.addToHistory !== false && nextTx.meta.origin !== "collab:remote" && !String(nextTx.meta.origin ?? "").startsWith("history:")) {
        undoStack.push({ document: cloneJson(docValue), selection: selection ? cloneJson(selection) : null });
        if (undoStack.length > historyLimit) undoStack.shift();
        redoStack.length = 0;
      }
      docValue = draft; version++; if (nextTx.selection !== undefined) selection = nextTx.selection ? cloneJson(nextTx.selection) : null; current = state();
      events.emit("state:change", { previous, state: current, transaction: freezeDeep(nextTx) });
      if (connection && nextTx.meta.origin !== "collab:remote") try { connection.sendLocal(nextTx); } catch (e) { events.emit("error", { source: "collaboration:send", error: e }); }
      return { ok: true, state: current, transaction: freezeDeep(nextTx) };
    },
    replaceDocument(input: unknown): ReplaceDocumentResult {
      if (destroyed) return { ok: false, issues: [{ code: "malformed", path: "", message: "Editor has been destroyed" }] };
      const result = parseDocument(input, { schema }); if (!result.ok) return { ok: false, issues: result.issues };
      const previous = current; docValue = result.document; version++; selection = null; history.clear(); current = state();
      events.emit("state:change", { previous, state: current, transaction: { id: ids(), ops: [], meta: { origin: "document:replace", timestamp: now(), addToHistory: false } } });
      return { ok: true, state: current };
    },
    setEditable(value: boolean) { if (!destroyed) editable = Boolean(value); },
    async destroy() { if (destroyed) return; destroyed = true; for (const off of collabOffs.splice(0)) try { off(); } catch {} await plugins.destroy(); if (connection) try { await connection.disconnect(); } catch (e) { events.emit("error", { source: "collaboration:disconnect", error: e }); } connection = undefined; commands.clear(); events.emit("destroy", {}); events.clear(); },
  };
  plugins = new Plugins(() => ed, schema, statusEvent, logger, nextSchema => { schema = nextSchema; current = state(); });
  for (const p of options.plugins ?? []) { const result = await plugins.register(p); if (!result.ok) throw new Error(`Plugin ${p.manifest.name} failed to register: ${result.message}`); }
  schema = plugins.schema; current = state();
  if (options.collaboration) try {
    connection = await options.collaboration.connect({ documentId: docValue.id, user: options.user ?? { id: "anonymous" }, localVersion: version });
    collabOffs.push(connection.onRemote(change => { for (const remote of change.transactions) { const { baseVersion: _baseVersion, ...withoutBase } = remote; const result = ed.dispatch({ ...withoutBase, meta: { ...remote.meta, origin: "collab:remote", addToHistory: false } }); if (!result.ok) events.emit("error", { source: "collaboration:remote", error: result.error }); } }));
  } catch (e) { events.emit("error", { source: "collaboration:connect", error: e }); }
  return ed;
}
