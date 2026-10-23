import type { BlockNode, Editor, EditorState, Inline, Mark, Transaction } from "@convetlib/core";
import { defaultIdGenerator } from "@convetlib/core";
import { isTextBlock, locateBlock, planCrossBlockEdit } from "./structure";

export interface ClipboardRun { readonly text: string; readonly marks: readonly Mark[]; }
export interface ClipboardBlock { readonly type: "paragraph" | "heading" | "codeBlock"; readonly attrs?: BlockNode["attrs"]; readonly runs: readonly ClipboardRun[]; }
export interface ClipboardPayload { readonly mime: "text/plain" | "text/html" | "application/x-convetlib-fragment+json"; readonly text: string; readonly html?: string; readonly runs?: readonly ClipboardRun[]; readonly blocks?: readonly ClipboardBlock[]; }
function findBlock(state: EditorState, id: string): BlockNode | undefined {
  const scan = (nodes: BlockNode[]): BlockNode | undefined => {
    for (const n of nodes) { if (n.id === id) return n; const kids = (n.content ?? []).filter((x): x is BlockNode => typeof (x as BlockNode).id === "string"); const found = scan(kids); if (found) return found; }
    return undefined;
  };
  for (const s of state.document.sections) { const found = scan(s.content) ?? scan(s.header ?? []) ?? scan(s.footer ?? []); if (found) return found; }
  return undefined;
}
function textBlocks(nodes: BlockNode[], out: BlockNode[] = []): BlockNode[] {
  for (const n of nodes) { if (isTextBlock(n)) out.push(n); else textBlocks((n.content ?? []).filter((x): x is BlockNode => typeof (x as BlockNode).id === "string"), out); }
  return out;
}
function blockText(b: BlockNode): string { return ((b.content ?? []) as Inline[]).map(n => n.type === "text" ? (n as Extract<Inline,{type:"text"}>).text : "\uFFFC").join(""); }
function runsForRange(b: BlockNode, from: number, to: number): ClipboardRun[] | undefined {
  const out: ClipboardRun[] = []; let pos = 0;
  for (const n of (b.content ?? []) as Inline[]) {
    const isText = n.type === "text" && typeof (n as {text?:unknown}).text === "string";
    const value = isText ? (n as Extract<Inline,{type:"text"}>).text : "\uFFFC", next = pos + value.length;
    if (!isText && pos < to && next > from) return undefined;
    if (isText && pos < to && next > from) { const text = value.slice(Math.max(0, from-pos), Math.min(value.length,to-pos)); if (text) out.push({text,marks:((n as Extract<Inline,{type:"text"}>).marks ?? []).map(m=>({...m}))}); }
    pos = next;
  }
  return out;
}
const plain = (blocks: readonly ClipboardBlock[]) => blocks.map(b => b.runs.map(r => r.text).join("")).join("\n");
const escapeHtml = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
function runsHtml(runs: readonly ClipboardRun[]): string {
  return runs.map(r => { let s=escapeHtml(r.text); for(const m of r.marks){if(m.type==="bold")s=`<strong>${s}</strong>`;else if(m.type==="italic")s=`<em>${s}</em>`;else if(m.type==="underline")s=`<u>${s}</u>`;else if(m.type==="strike")s=`<s>${s}</s>`;else if(m.type==="code")s=`<code>${s}</code>`;} return s; }).join("");
}
function toHtml(blocks: readonly ClipboardBlock[]): string {
  return blocks.map(b=>{const tag=b.type==="heading"?`h${Math.min(6,Math.max(1,Number(b.attrs?.level ?? 1)))}`:b.type==="codeBlock"?"pre":"p";return `<${tag}>${runsHtml(b.runs)}</${tag}>`;}).join("");
}
function selectedBlocks(state: EditorState): ClipboardBlock[] | undefined {
  const s=state.selection;if(!s||(s.anchor.blockId===s.head.blockId&&s.anchor.offset===s.head.offset))return undefined;
  const a=locateBlock(state,s.anchor.blockId),h=locateBlock(state,s.head.blockId);
  if(!a||!h||a.sectionIndex!==h.sectionIndex||a.slot!==h.slot)return undefined;
  if(s.anchor.blockId!==s.head.blockId&&!planCrossBlockEdit(state,{ids:()=>"clipboard-probe"}))return undefined;
  const section=state.document.sections[a.sectionIndex]!,root=a.slot==="header"?section.header??[]:a.slot==="footer"?section.footer??[]:section.content;
  const all=textBlocks(root),ai=all.findIndex(b=>b.id===s.anchor.blockId),hi=all.findIndex(b=>b.id===s.head.blockId);
  if(ai<0||hi<0)return undefined;const start=Math.min(ai,hi),end=Math.max(ai,hi),forward=ai<=hi;
  const from=forward?s.anchor.offset:s.head.offset,to=forward?s.head.offset:s.anchor.offset,out:ClipboardBlock[]=[];
  for(let i=start;i<=end;i++){const b=all[i]!,len=blockText(b).length,lo=i===start?from:0,hiOffset=i===end?to:len;if(lo<0||hiOffset<lo||hiOffset>len)return undefined;const runs=runsForRange(b,lo,hiOffset);if(!runs)return undefined;const type=b.type==="heading"||b.type==="codeBlock"?b.type:"paragraph";out.push({type,...(b.attrs?{attrs:b.attrs}:{}),runs});}
  return out;
}
export function copySelection(editor: Pick<Editor,"state">): ClipboardPayload | undefined {
  const blocks=selectedBlocks(editor.state);if(!blocks?.length)return undefined;
  const text=plain(blocks),html=toHtml(blocks);
  return {mime:"application/x-convetlib-fragment+json",text,html,blocks,...(blocks.length===1?{runs:blocks[0]!.runs}:{})};
}
export function cutSelection(editor: Editor): ClipboardPayload | undefined {
  const payload=copySelection(editor);if(!payload)return undefined;const state=editor.state,s=state.selection!;
  if(s.anchor.blockId!==s.head.blockId){const plan=planCrossBlockEdit(state,{ids:defaultIdGenerator});if(!plan)return undefined;const r=editor.dispatch({id:defaultIdGenerator(),baseVersion:state.version,ops:plan.ops,selection:{anchor:plan.caret,head:plan.caret},meta:{origin:"clipboard.cut",timestamp:new Date().toISOString()}});return r.ok?payload:undefined;}
  return editor.commands.execute("text.deleteBackward").ok?payload:undefined;
}
export function pastePlainText(editor: Editor,text: string): boolean { return typeof text==="string"&&editor.commands.execute("text.insert",{text}).ok; }
export function pasteClipboardPayload(editor: Editor, payload: ClipboardPayload): boolean {
  const blocks = payload.blocks?.length ? payload.blocks : payload.runs?.length ? [{ type: "paragraph" as const, runs: payload.runs }] : undefined;
  if (!blocks?.length) return pastePlainText(editor, payload.text);
  const state = editor.state, selection = state.selection;
  if (!selection) return false;

  const spansBlocks = selection.anchor.blockId !== selection.head.blockId;
  const plan = spansBlocks ? planCrossBlockEdit(state, { ids: defaultIdGenerator }) : undefined;
  // Preserve structural safety: rich replacement across blocks is supported only when the
  // planner can produce a single surviving text block to split around the pasted fragment.
  if (spansBlocks && !plan?.joined) return pastePlainText(editor, payload.text);

  const targetId = plan?.caret.blockId ?? selection.anchor.blockId;
  const target = findBlock(state, targetId), location = locateBlock(state, targetId);
  if (!target || !location || !isTextBlock(target)) return false;
  const from = plan?.caret.offset ?? Math.min(selection.anchor.offset, selection.head.offset);
  const to = Math.max(selection.anchor.offset, selection.head.offset);
  const parent = location.chain.length === 1
    ? { kind: "section" as const, id: state.document.sections[location.sectionIndex]!.id, slot: location.slot }
    : { kind: "node" as const, id: location.chain[location.chain.length - 2]!.id };
  const siblings = location.lists[location.lists.length - 1]!;
  const index = siblings.findIndex(node => node.id === targetId);
  if (index < 0) return false;

  const ops: Transaction["ops"][number][] = plan ? [...plan.ops] : [];
  if (!plan && to > from) ops.push({ type: "delete_text", blockId: targetId, from, to });
  if (blocks.length === 1) {
    let offset = from;
    for (const run of blocks[0]!.runs) {
      if (!run.text) continue;
      ops.push({ type: "insert_text", at: { blockId: targetId, offset }, text: run.text, ...(run.marks.length ? { marks: run.marks } : {}) });
      offset += run.text.length;
    }
    const caret = { blockId: targetId, offset };
    return editor.dispatch({ id: defaultIdGenerator(), baseVersion: state.version, ops, selection: { anchor: caret, head: caret }, meta: { origin: "clipboard.pasteRich", timestamp: new Date().toISOString() } }).ok;
  }

  const tailId = defaultIdGenerator();
  ops.push({ type: "split_block", id: targetId, offset: from, newId: tailId });
  const lastFragment = blocks[blocks.length - 1]!;
  ops.push({ type: "set_node_type", id: tailId, nodeType: lastFragment.type, attrs: lastFragment.attrs ?? {} });
  let firstOffset = from;
  for (const run of blocks[0]!.runs) {
    if (!run.text) continue;
    ops.push({ type: "insert_text", at: { blockId: targetId, offset: firstOffset }, text: run.text, ...(run.marks.length ? { marks: run.marks } : {}) });
    firstOffset += run.text.length;
  }
  let insertIndex = index + 1;
  for (const fragment of blocks.slice(1, -1)) {
    const node: BlockNode = {
      type: fragment.type, id: defaultIdGenerator(), ...(fragment.attrs ? { attrs: fragment.attrs } : {}),
      content: fragment.runs.filter(run => run.text).map(run => ({ type: "text", text: run.text, ...(run.marks.length ? { marks: run.marks } : {}) }))
    };
    ops.push({ type: "insert_block", parent, index: insertIndex++, node });
  }
  let lastOffset = 0;
  for (const run of lastFragment.runs) {
    if (!run.text) continue;
    ops.push({ type: "insert_text", at: { blockId: tailId, offset: lastOffset }, text: run.text, ...(run.marks.length ? { marks: run.marks } : {}) });
    lastOffset += run.text.length;
  }
  const caret = { blockId: tailId, offset: lastOffset };
  return editor.dispatch({ id: defaultIdGenerator(), baseVersion: state.version, ops, selection: { anchor: caret, head: caret }, meta: { origin: "clipboard.pasteRich", timestamp: new Date().toISOString() } }).ok;
}
function markForTag(tag:string): Mark|undefined {if(tag==="b"||tag==="strong")return {type:"bold"};if(tag==="i"||tag==="em")return {type:"italic"};if(tag==="u")return {type:"underline"};if(["s","strike","del"].includes(tag))return {type:"strike"};if(tag==="code")return {type:"code"};return undefined;}
/** Conservative HTML import: discards active elements and all attributes; only basic inline marks survive. */
export function htmlToClipboardPayload(html:string): ClipboardPayload|undefined {
  if(typeof html!=="string"||html.length>1_000_000)return undefined;
  const safe=html.replace(/<(script|style|iframe|object|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,""),blocks:ClipboardBlock[]=[];let runs:ClipboardRun[]=[],marks:Mark[]=[],tag="p";
  const flush=()=>{const heading=/^h([1-6])$/.exec(tag);blocks.push({type:tag==="pre"?"codeBlock":heading?"heading":"paragraph",...(heading?{attrs:{level:Number(heading[1])}}:{}),runs});runs=[];};
  for(const token of safe.match(/<[^>]*>|[^<]+/g)??[]){const close=token.match(/^<\s*\/\s*([a-z0-9]+)[^>]*>$/i),open=token.match(/^<\s*([a-z0-9]+)\b[^>]*>$/i);
    if(close){const t=close[1]!.toLowerCase();if(["p","div","li","pre","h1","h2","h3","h4","h5","h6"].includes(t)){flush();tag="p";}else{const m=markForTag(t);if(m){const i=marks.map(x=>x.type).lastIndexOf(m.type);if(i>=0)marks.splice(i,1);}}}
    else if(open){const t=open[1]!.toLowerCase();if(["p","div","li","pre","h1","h2","h3","h4","h5","h6"].includes(t)){if(runs.length)flush();tag=t;}else{const m=markForTag(t);if(m)marks.push(m);}if(/^<\s*br\b/i.test(token))runs.push({text:"\n",marks:[...marks]});}
    else{const value=token.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'");if(value)runs.push({text:value,marks:[...marks]});}
  }
  if(runs.length||!blocks.length)flush();const normalized=blocks.filter((b,i)=>b.runs.length||i===0),text=plain(normalized);return {mime:"application/x-convetlib-fragment+json",text,html:toHtml(normalized),blocks:normalized,...(normalized.length===1?{runs:normalized[0]!.runs}:{})};
}
export interface ClipboardBridge { readText():Promise<string>; writeText(text:string):Promise<void>; readHtml?():Promise<string|undefined>; writeHtml?(html:string):Promise<void>; }
/** Adapter contract for OS clipboard. Browser adapters may implement text/html as well as text/plain. */
export async function handleClipboardShortcut(editor:Editor,event:{key:string;ctrlKey?:boolean;metaKey?:boolean;altKey?:boolean;isComposing?:boolean;preventDefault?():void},clipboard:ClipboardBridge):Promise<{handled:boolean;command?:string;reason?:string}> {
  if(event.isComposing||event.altKey||!(event.ctrlKey||event.metaKey))return {handled:false};const key=event.key.toLowerCase();
  if(key==="c"||key==="x"){const payload=key==="c"?copySelection(editor):cutSelection(editor);if(!payload)return {handled:false,reason:"No supported text selection"};await clipboard.writeText(payload.text);if(payload.html&&clipboard.writeHtml)await clipboard.writeHtml(payload.html);event.preventDefault?.();return {handled:true,command:key==="c"?"clipboard.copy":"clipboard.cut"};}
  if(key==="v"){const html=await clipboard.readHtml?.();const rich=html?htmlToClipboardPayload(html):undefined;const ok=rich?pasteClipboardPayload(editor,rich):pastePlainText(editor,await clipboard.readText());if(!ok)return {handled:false,reason:"Paste command unavailable"};event.preventDefault?.();return {handled:true,command:"clipboard.paste"};}
  return {handled:false};
}
