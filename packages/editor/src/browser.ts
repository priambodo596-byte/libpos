import type { Editor, Selection as ModelSelection } from "@convetlib/core";
import { handleKeyboardShortcut, setSelection } from "./index";
import { copySelection, cutSelection, htmlToClipboardPayload, pasteClipboardPayload } from "./clipboard";

export interface BrowserEditorBindingOptions {
  /** The host-rendered editable root. Leaf text blocks must carry data-block-id="<model id>". */
  readonly root: HTMLElement;
  /** Re-render the host DOM after the model changes. */
  readonly render?: () => void;
  readonly onError?: (error: unknown) => void;
  readonly readOnly?: boolean;
}
export interface BrowserEditorBinding {
  readonly refreshSelection: () => boolean;
  readonly destroy: () => void;
}
function blockElement(root: HTMLElement, id: string): HTMLElement | undefined {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-block-id]"))) if (el.dataset.blockId === id) return el;
  return undefined;
}
function leafBlockAt(root: HTMLElement, node: Node | null): HTMLElement | undefined {
  if (!node) return undefined;
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const block = element?.closest<HTMLElement>("[data-block-id]");
  return block && root.contains(block) ? block : undefined;
}
function isInlineAtom(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute("data-inline-atom");
}
function domModelLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (isInlineAtom(node)) return 1;
  return Array.from(node.childNodes).reduce((sum, child) => sum + domModelLength(child), 0);
}
function offsetWithin(block: HTMLElement, target: Node, targetOffset: number): number | undefined {
  if (target !== block && !block.contains(target)) return undefined;
  const visit = (node: Node): number | undefined => {
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        const length = node.textContent?.length ?? 0;
        return Number.isInteger(targetOffset) && targetOffset >= 0 && targetOffset <= length ? targetOffset : undefined;
      }
      if (isInlineAtom(node)) return undefined;
      const children = Array.from(node.childNodes);
      if (!Number.isInteger(targetOffset) || targetOffset < 0 || targetOffset > children.length) return undefined;
      return children.slice(0, targetOffset).reduce((sum, child) => sum + domModelLength(child), 0);
    }
    if (isInlineAtom(node)) return undefined;
    let before = 0;
    for (const child of Array.from(node.childNodes)) {
      if (child === target || child.contains(target)) {
        const nested = visit(child);
        return nested === undefined ? undefined : before + nested;
      }
      before += domModelLength(child);
    }
    return undefined;
  };
  return visit(block);
}
function domPointAt(block: HTMLElement, wanted: number): {node: Node; offset: number} {
  const visit = (node: Node, offset: number): {node: Node; offset: number} | undefined => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      return offset >= 0 && offset <= len ? {node, offset} : undefined;
    }
    if (isInlineAtom(node)) {
      const parent = node.parentNode;
      if (!parent) return undefined;
      const index = Array.prototype.indexOf.call(parent.childNodes, node) as number;
      if (offset === 0) return {node: parent, offset: index};
      if (offset === 1) return {node: parent, offset: index + 1};
      return undefined;
    }
    const children = Array.from(node.childNodes);
    let remaining = offset;
    for (let index = 0; index < children.length; index++) {
      const child = children[index]!, len = domModelLength(child);
      if (isInlineAtom(child)) {
        if (remaining === 0) return {node, offset: index};
        if (remaining === 1) return {node, offset: index + 1};
      }
      if (remaining <= len) return visit(child, remaining);
      remaining -= len;
    }
    return remaining === 0 ? {node, offset: children.length} : undefined;
  };
  return visit(block, wanted) ?? {node:block,offset:block.childNodes.length};
}
function modelPosition(root: HTMLElement, node: Node | null, offset: number) {
  const block = leafBlockAt(root,node); if (!block?.dataset.blockId || !node) return undefined;
  const modelOffset = offsetWithin(block,node,offset); if (modelOffset === undefined) return undefined;
  return {blockId:block.dataset.blockId,offset:modelOffset};
}
function writeModelSelection(root: HTMLElement, editor: Editor): boolean {
  const selection = root.ownerDocument.getSelection(); if (!selection?.anchorNode || !selection.focusNode) return false;
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return false;
  const anchor=modelPosition(root,selection.anchorNode,selection.anchorOffset),head=modelPosition(root,selection.focusNode,selection.focusOffset);
  if (!anchor||!head) return false;
  const current=editor.state.selection;
  if(current && current.anchor.blockId===anchor.blockId && current.anchor.offset===anchor.offset && current.head.blockId===head.blockId && current.head.offset===head.offset)return true;
  return setSelection(editor,{anchor,head}).ok;
}
function restoreDomSelection(root: HTMLElement, selection: ModelSelection | null | undefined): boolean {
  if (!selection) return false;
  const a=blockElement(root,selection.anchor.blockId),h=blockElement(root,selection.head.blockId);if(!a||!h)return false;
  const ap=domPointAt(a,selection.anchor.offset),hp=domPointAt(h,selection.head.offset),native=root.ownerDocument.getSelection();if(!native)return false;
  native.setBaseAndExtent(ap.node,ap.offset,hp.node,hp.offset);return true;
}
function clipboardPayloadFromEvent(event: ClipboardEvent) {
  const data=event.clipboardData;if(!data)return undefined;
  const html=data.getData("text/html");
  if(html){const rich=htmlToClipboardPayload(html);if(rich)return rich;}
  const text=data.getData("text/plain");
  return {mime:"text/plain" as const,text};
}
/**
 * Wires model commands to real browser events for a host-rendered editor.
 * The host owns rendering; every editable leaf block must be tagged with data-block-id.
 */
export function bindBrowserEditor(editor: Editor, options: BrowserEditorBindingOptions): BrowserEditorBinding {
  const {root}=options,doc=root.ownerDocument,disposers:Array<()=>void>=[];let composing=false,disposed=false;
  const listen=<K extends keyof HTMLElementEventMap>(target:HTMLElement|Document,type:K,fn:(event:HTMLElementEventMap[K])=>void)=>{target.addEventListener(type,fn as EventListener);disposers.push(()=>target.removeEventListener(type,fn as EventListener));};
  const report=(error:unknown)=>options.onError?.(error);
  const sync=()=>{if(!disposed&&!composing){try{writeModelSelection(root,editor);}catch(e){report(e);}}};
  const update=()=>{try{restoreDomSelection(root,editor.state.selection);}catch(e){report(e);}};
  const run=(fn:()=>boolean,ev:Event)=>{if(options.readOnly)return false;ev.preventDefault();try{const ok=fn();if(ok)update();return ok;}catch(e){report(e);return false;}};
  root.setAttribute("role","textbox");root.setAttribute("aria-multiline","true");root.setAttribute("aria-readonly",String(Boolean(options.readOnly)));
  root.setAttribute("contenteditable",options.readOnly?"false":"true");
  listen(root,"keydown",(raw)=>{const e=raw as KeyboardEvent;if(options.readOnly)return;sync();const result=handleKeyboardShortcut(editor,e);if(result.handled){update();return;}const key=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;if(key==="enter"||key==="backspace"||key==="delete"||(mod&&["b","i","u","z","y"].includes(key)))e.preventDefault();});
  listen(root,"beforeinput",(raw)=>{const e=raw as InputEvent;if(options.readOnly||composing||e.isComposing||e.inputType==="insertFromComposition"||e.inputType==="insertCompositionText")return;sync();
    if(e.inputType==="insertText"&&typeof e.data==="string"){run(()=>editor.commands.execute("text.insert",{text:e.data!}).ok,e);return;}
    if(e.inputType==="insertParagraph"||e.inputType==="insertLineBreak"){run(()=>editor.commands.execute("block.split").ok,e);return;}
    if(e.inputType==="deleteContentBackward"){run(()=>editor.commands.execute("text.deleteBackward").ok,e);return;}
    if(e.inputType==="deleteContentForward"){run(()=>editor.commands.execute("text.deleteForward").ok,e);return;}
  });
  listen(root,"compositionstart",()=>{sync();composing=true;});
  listen(root,"compositionend",(raw)=>{const e=raw as CompositionEvent;composing=false;if(options.readOnly||!e.data)return;run(()=>editor.commands.execute("text.insert",{text:e.data}).ok,e);});
  listen(root,"copy",(raw)=>{const e=raw as ClipboardEvent;sync();const p=copySelection(editor);if(!p||!e.clipboardData)return;e.clipboardData.setData("text/plain",p.text);if(p.html)e.clipboardData.setData("text/html",p.html);e.preventDefault();});
  listen(root,"cut",(raw)=>{const e=raw as ClipboardEvent;if(options.readOnly||!e.clipboardData)return;sync();const p=cutSelection(editor);if(!p)return;e.clipboardData.setData("text/plain",p.text);if(p.html)e.clipboardData.setData("text/html",p.html);e.preventDefault();update();});
  listen(root,"paste",(raw)=>{const e=raw as ClipboardEvent;if(options.readOnly)return;sync();const p=clipboardPayloadFromEvent(e);if(!p)return;run(()=>p.mime==="text/plain"?editor.commands.execute("text.insert",{text:p.text}).ok:pasteClipboardPayload(editor,p),e);});
  listen(doc,"selectionchange",()=>{if(!composing)sync();});
  const refreshSelection=()=>{if(disposed)return false;try{return writeModelSelection(root,editor);}catch(e){report(e);return false;}};
  const unsubscribe=editor.on("state:change",({transaction})=>{if(!disposed&&transaction.meta.origin!=="selection.set"){try{options.render?.();restoreDomSelection(root,editor.state.selection);}catch(e){report(e);}}});
  if(typeof unsubscribe==="function")disposers.push(unsubscribe);
  return {refreshSelection,destroy(){if(disposed)return;disposed=true;for(const off of disposers.splice(0).reverse())off();}};
}
