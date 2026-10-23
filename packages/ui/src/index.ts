import type { Editor } from "@convetlib/core";
export interface ToolbarItem { readonly id:string; readonly label:string; readonly command:string; readonly group:"text"|"block"|"insert"|"history"; readonly args?:unknown; }
export interface ToolbarItemState extends ToolbarItem { readonly enabled:boolean; readonly active:boolean; }
export const DEFAULT_TOOLBAR:readonly ToolbarItem[]=Object.freeze([
{id:"bold",label:"Bold",command:"text.toggleBold",group:"text"},
{id:"italic",label:"Italic",command:"text.toggleItalic",group:"text"},
{id:"underline",label:"Underline",command:"text.toggleUnderline",group:"text"},
{id:"strike",label:"Strikethrough",command:"text.toggleStrike",group:"text"},
{id:"paragraph",label:"Paragraph",command:"block.setParagraph",group:"block"},
{id:"heading-1",label:"Heading 1",command:"block.setHeading",group:"block",args:{level:1}},
{id:"heading-2",label:"Heading 2",command:"block.setHeading",group:"block",args:{level:2}},
{id:"align-left",label:"Align left",command:"block.setAlignment",group:"block",args:{align:"left"}},
{id:"align-center",label:"Align center",command:"block.setAlignment",group:"block",args:{align:"center"}},
{id:"align-right",label:"Align right",command:"block.setAlignment",group:"block",args:{align:"right"}},
{id:"align-justify",label:"Justify",command:"block.setAlignment",group:"block",args:{align:"justify"}},
{id:"split",label:"New paragraph",command:"block.split",group:"insert"}]);
/** Derives UI state from the editor without DOM or framework dependencies. */
export function getToolbarState(editor:Pick<Editor,"state"|"commands">,items:readonly ToolbarItem[]=DEFAULT_TOOLBAR):readonly ToolbarItemState[]{
 const selection=editor.state.selection;
 const id=selection&&selection.anchor.blockId===selection.head.blockId?selection.anchor.blockId:undefined;
 const block=id?editor.state.document.sections.flatMap(s=>s.content).find(b=>b.id===id):undefined;
 return items.map(item=>{
  let active=false;
  if(block){
   if(item.id==="heading-1")active=block.type==="heading"&&block.attrs?.level===1;
   else if(item.id==="heading-2")active=block.type==="heading"&&block.attrs?.level===2;
   else if(item.id==="paragraph")active=block.type==="paragraph";
   else if(item.id.startsWith("align-"))active=(block.attrs?.align??"left")===item.id.slice(6);
   else if(["bold","italic","underline","strike"].includes(item.id)&&selection&&selection.anchor.offset!==selection.head.offset){
    const from=Math.min(selection.anchor.offset,selection.head.offset),to=Math.max(selection.anchor.offset,selection.head.offset);let pos=0;
    for(const raw of block.content??[]){if(typeof(raw as {id?:unknown}).id==="string")continue;const n=raw as {type:string;text?:string;marks?:{type:string}[]};const len=n.type==="text"?(n.text??"").length:1;if(pos<to&&pos+len>from&&(n.marks??[]).some(m=>m.type===item.id))active=true;pos+=len;}
   }
  }
  return {...item,enabled:editor.commands.can(item.command,item.args),active};
 });
}
