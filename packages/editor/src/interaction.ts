import type { Editor } from "@convetlib/core";

export interface KeyboardInput { readonly key:string; readonly ctrlKey?:boolean; readonly metaKey?:boolean; readonly shiftKey?:boolean; readonly altKey?:boolean; readonly isComposing?:boolean; preventDefault?():void; }
export interface ShortcutResult { readonly handled:boolean; readonly command?:string; readonly reason?:string; }
/** Maps normalized key input to SDK commands; a UI adapter supplies real keyboard events. */
export function handleKeyboardShortcut(editor:Editor,event:KeyboardInput):ShortcutResult {
  if(event.isComposing||event.altKey)return {handled:false,reason:"composition-or-alt-modified"};
  const mod=Boolean(event.ctrlKey||event.metaKey),key=event.key.toLowerCase();let command:string|undefined;
  if(mod&&!event.shiftKey&&key==="b")command="text.toggleBold";
  else if(mod&&!event.shiftKey&&key==="i")command="text.toggleItalic";
  else if(mod&&!event.shiftKey&&key==="u")command="text.toggleUnderline";
  else if(mod&&key==="z")command=event.shiftKey?"history.redo":"history.undo";
  else if(mod&&key==="y")command="history.redo";
  else if(!mod&&!event.shiftKey&&key==="enter")command="block.split";
  else if(!mod&&key==="backspace")command="text.deleteBackward";
  else if(!mod&&key==="delete")command="text.deleteForward";
  if(!command)return {handled:false};
  const result=command==="history.undo"?{ok:editor.history.undo()}:command==="history.redo"?{ok:editor.history.redo()}:editor.commands.execute(command);
  if(!result.ok)return {handled:false,command,reason:"reason" in result?result.reason:"Command unavailable"};
  event.preventDefault?.();return {handled:true,command};
}
export interface CompositionBuffer {readonly composing:boolean;readonly text:string;start():void;update(text:string):void;end():boolean;cancel():void;}
/** Buffer IME updates and dispatch a single committed insertion when composition ends. */
export function createCompositionBuffer(editor:Editor):CompositionBuffer {
  let composing=false,text="";
  return {get composing(){return composing;},get text(){return text;},start(){composing=true;text="";},update(value){if(composing)text=value;},end(){if(!composing)return false;composing=false;const value=text;text="";return value.length===0||editor.commands.execute("text.insert",{text:value}).ok;},cancel(){composing=false;text="";}};
}
export interface EditorAccessibilityProps {readonly role:"textbox";readonly "aria-label":string;readonly "aria-multiline":true;readonly "aria-readonly":boolean;readonly "aria-describedby"?:string;readonly "aria-keyshortcuts":string;}
/** Accessible semantics contract for host-rendered editing surfaces; does not render DOM. */
export function getEditorAccessibilityProps(options:{label:string;readOnly?:boolean;describedBy?:string}):EditorAccessibilityProps {
  return {role:"textbox","aria-label":options.label,"aria-multiline":true,"aria-readonly":Boolean(options.readOnly),...(options.describedBy?{"aria-describedby":options.describedBy}:{}),"aria-keyshortcuts":"Control+B Control+I Control+U Control+Z Control+Y Enter Backspace Delete"};
}
export * from "./clipboard";
