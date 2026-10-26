import type { Editor, EditorState, CommandSpec, Transaction, Selection, Mark, BlockNode, Inline, IdGenerator } from "@convetlib/core";
import { defaultIdGenerator } from "@convetlib/core";
import { canEditAcrossBlocks, isTextBlock, locateBlock, planCrossBlockEdit, selectionSpansBlocks, textLength } from "./structure";

export interface EditingOptions { ids?: IdGenerator; now?: () => string; authorId?: string; }
const UNSUPPORTED_SPAN = "This selection spans blocks in different sections or slots, or non-text blocks, which is not supported";
export interface InsertTextArgs { text: string; }
export interface SetHeadingArgs { level: 1 | 2 | 3 | 4 | 5 | 6; }
export interface SetAlignmentArgs { align: "left" | "center" | "right" | "justify"; }
const isBlock = (n: BlockNode | Inline): n is BlockNode => typeof (n as BlockNode).id === "string";
const isText = (n: Inline): n is Extract<Inline, {type:"text"}> => n.type === "text" && typeof (n as {text?:unknown}).text === "string";
function walk(nodes: BlockNode[], visit: (n: BlockNode) => boolean): BlockNode | undefined {
  for (const n of nodes) { if (visit(n)) return n; const f = walk((n.content ?? []).filter(isBlock), visit); if (f) return f; } return undefined;
}
function findBlock(state: EditorState, id: string): BlockNode | undefined {
  for (const s of state.document.sections) { const b = walk([...s.content, ...(s.header ?? []), ...(s.footer ?? [])], n => n.id === id); if (b) return b; } return undefined;
}
function length(b: BlockNode): number { return (b.content ?? []).reduce((sum,n) => sum + (isBlock(n) ? 0 : isText(n) ? n.text.length : 1), 0); }
function range(state: EditorState) {
  const s = state.selection; if (!s || s.anchor.blockId !== s.head.blockId) return undefined;
  return { blockId:s.anchor.blockId, from:Math.min(s.anchor.offset,s.head.offset), to:Math.max(s.anchor.offset,s.head.offset) };
}
interface SelectedBlockRange { block: BlockNode; from: number; to: number; }
function selectedBlockRanges(state: EditorState): SelectedBlockRange[] | undefined {
  const s=state.selection;if(!s)return undefined;
  const a=locateBlock(state,s.anchor.blockId),h=locateBlock(state,s.head.blockId);
  if(!a||!h||a.sectionIndex!==h.sectionIndex||a.slot!==h.slot)return undefined;
  const section=state.document.sections[a.sectionIndex]!,nodes=a.slot==="header"?section.header??[]:a.slot==="footer"?section.footer??[]:section.content;
  const all:BlockNode[]=[];
  const collect=(items:BlockNode[])=>{for(const b of items){if(isTextBlock(b))all.push(b);else collect((b.content??[]).filter(isBlock));}};
  collect(nodes);
  const ai=all.findIndex(b=>b.id===s.anchor.blockId),hi=all.findIndex(b=>b.id===s.head.blockId);
  if(ai<0||hi<0)return undefined;
  const forward=ai<hi||(ai===hi&&s.anchor.offset<=s.head.offset),start=Math.min(ai,hi),end=Math.max(ai,hi),from=forward?s.anchor.offset:s.head.offset,to=forward?s.head.offset:s.anchor.offset;
  const out:SelectedBlockRange[]=[];
  for(let i=start;i<=end;i++){const block=all[i]!,len=textLength(block),lo=i===start?from:0,hiOffset=i===end?to:len;if(!Number.isInteger(lo)||!Number.isInteger(hiOffset)||lo<0||hiOffset<lo||hiOffset>len)return undefined;out.push({block,from:lo,to:hiOffset});}
  return out;
}
interface TableContext { table: BlockNode; row: BlockNode; cell: BlockNode; rows: BlockNode[]; cells: BlockNode[]; rowIndex: number; columnIndex: number; }
function tableContext(state: EditorState): TableContext | undefined {
  const selection=state.selection;if(!selection||selection.anchor.blockId!==selection.head.blockId)return undefined;
  const loc=locateBlock(state,selection.anchor.blockId);if(!loc)return undefined;
  const cellIndex=loc.chain.map(n=>n.type).lastIndexOf("tableCell"),rowIndexInChain=loc.chain.map(n=>n.type).lastIndexOf("tableRow"),tableIndex=loc.chain.map(n=>n.type).lastIndexOf("table");
  if(cellIndex<0||rowIndexInChain<0||tableIndex<0)return undefined;
  const cell=loc.chain[cellIndex]!,row=loc.chain[rowIndexInChain]!,table=loc.chain[tableIndex]!;
  const cells=(row.content??[]).filter(isBlock),rows=(table.content??[]).filter(isBlock);
  const rowIndex=rows.findIndex(n=>n.id===row.id),columnIndex=cells.findIndex(n=>n.id===cell.id);
  if(rowIndex<0||columnIndex<0||rows.some(r=>r.type!=="tableRow"))return undefined;
  return {table,row,cell,rows,cells,rowIndex,columnIndex};
}
function hasMergedCells(table:BlockNode):boolean {
  return (table.content??[]).filter(isBlock).some(row=>(row.content??[]).filter(isBlock).some(cell=>Number(cell.attrs?.colspan??1)>1||Number(cell.attrs?.rowspan??1)>1));
}
function canDeleteTableRow(state:EditorState):boolean {
  const c=tableContext(state);return !!c&&c.rows.length>1;
}
function canDeleteTableColumn(state:EditorState):boolean {
  const c=tableContext(state);if(!c||hasMergedCells(c.table)||c.cells.length<2)return false;
  return c.rows.every(row=>{const cells=(row.content??[]).filter(isBlock);return cells.length===c.cells.length&&cells.every(cell=>cell.type==="tableCell");});
}
function firstTextDescendant(node:BlockNode):BlockNode|undefined {
  if(["paragraph","heading","codeBlock"].includes(node.type)&&!(node.content??[]).some(isBlock))return node;
  for(const child of (node.content??[]).filter(isBlock)){const found=firstTextDescendant(child);if(found)return found;}
  return undefined;
}
interface SiblingContext { list: BlockNode[]; index: number; }
function siblingContext(state: EditorState, id: string): SiblingContext | undefined {
  const scan = (list: BlockNode[]): SiblingContext | undefined => {
    const index = list.findIndex(b => b.id === id);
    if (index >= 0) return { list, index };
    for (const node of list) {
      const children = (node.content ?? []) as BlockNode[];
      if (!children.some(isBlock)) continue;
      const found = scan(children);
      if (found) return found;
    }
    return undefined;
  };
  for (const section of state.document.sections) {
    const found = scan(section.content) ?? scan(section.header ?? []) ?? scan(section.footer ?? []);
    if (found) return found;
  }
  return undefined;
}
function firstTextblock(state: EditorState) {
  for (const s of state.document.sections) { const b = walk(s.content,n => ["paragraph","heading","codeBlock"].includes(n.type) && !(n.content ?? []).some(isBlock)); if (b) return b; } return undefined;
}
function activeMark(state: EditorState, type: string): boolean {
  const r = range(state); if (!r || r.from === r.to) return false; const b = findBlock(state,r.blockId); if (!b) return false;
  let pos=0; for (const n of (b.content ?? []) as Inline[]) { const len=isText(n)?n.text.length:1; if (pos<r.to && pos+len>r.from && isText(n) && (n.marks??[]).some(m=>m.type===type)) return true; pos+=len; } return false;
}
function txMeta(options: EditingOptions, origin: string) { return { origin, timestamp:(options.now ?? (()=>new Date().toISOString()))(), ...(options.authorId?{authorId:options.authorId}:{}) }; }
export function createEditingCommands(options: EditingOptions = {}): CommandSpec[] {
  const ids=options.ids ?? defaultIdGenerator, now=options.now ?? (()=>new Date().toISOString());
  const cmd=(id:string,run:CommandSpec["run"],canRun?:CommandSpec["canRun"]):CommandSpec=>({id,title:id,run,...(canRun?{canRun}:{})});
  const insert=cmd("text.insert",({state},args:InsertTextArgs)=>{
    if (!args || typeof args.text!=="string") return {ok:false,reason:"text.insert requires a text string"};
    const cross=planCrossBlockEdit(state,{ids,insertText:args.text});
    if(cross) return {ok:true,transaction:{id:ids(),baseVersion:state.version,ops:cross.ops,selection:{anchor:cross.caret,head:cross.caret},meta:txMeta(options,"text.replaceAcrossBlocks")}};
    if(selectionSpansBlocks(state)) return {ok:false,reason:UNSUPPORTED_SPAN};
    const r=range(state), b=r?findBlock(state,r.blockId):firstTextblock(state); if(!b || (b.content??[]).some(isBlock)) return {ok:false,reason:"No editable text block is available"};
    const from=r?r.from:length(b), to=r?r.to:from, ops:Transaction["ops"][number][]=[];
    if(to>from) ops.push({type:"delete_text",blockId:b.id,from,to}); if(args.text) ops.push({type:"insert_text",at:{blockId:b.id,offset:from},text:args.text});
    const p={blockId:b.id,offset:from+args.text.length};
    return {ok:true,transaction:{id:ids(),baseVersion:state.version,ops,selection:{anchor:p,head:p},meta:txMeta(options,"text.insert")}};
  },({state})=>canEditAcrossBlocks(state)||!!range(state)||(!selectionSpansBlocks(state)&&!!firstTextblock(state)));
  const deleteDir=(direction:"backward"|"forward")=>cmd("text.delete"+(direction==="backward"?"Backward":"Forward"),({state})=>{
    const cross=planCrossBlockEdit(state,{ids});
    if(cross) return {ok:true,transaction:{id:ids(),baseVersion:state.version,ops:cross.ops,selection:{anchor:cross.caret,head:cross.caret},meta:txMeta(options,"text.deleteSelectionAcrossBlocks")}};
    if(selectionSpansBlocks(state)) return {ok:false,reason:UNSUPPORTED_SPAN};
    const r=range(state), b=r?findBlock(state,r.blockId):undefined; if(!r||!b) return {ok:false,reason:"A caret or selection in one text block is required"};
    if(r.from===r.to && (b.content??[]).every(n=>!isBlock(n))){
      const ctx=siblingContext(state,b.id);
      if(direction==="backward" && r.from===0 && ctx && ctx.index>0){
        const previous=ctx.list[ctx.index-1]!;
        if(!(previous.content??[]).some(isBlock)){
          const p={blockId:previous.id,offset:length(previous)};
          return {ok:true,transaction:{id:ids(),baseVersion:state.version,ops:[{type:"join_blocks",firstId:previous.id,secondId:b.id}],selection:{anchor:p,head:p},meta:txMeta(options,"text.joinBackward")}};
        }
      }
      if(direction==="forward" && r.from===length(b) && ctx && ctx.index+1<ctx.list.length){
        const next=ctx.list[ctx.index+1]!;
        if(!(next.content??[]).some(isBlock)){
          const p={blockId:b.id,offset:length(b)};
          return {ok:true,transaction:{id:ids(),baseVersion:state.version,ops:[{type:"join_blocks",firstId:b.id,secondId:next.id}],selection:{anchor:p,head:p},meta:txMeta(options,"text.joinForward")}};
        }
      }
    }
    const from=r.to>r.from?r.from:direction==="backward"?r.from-1:r.from, to=r.to>r.from?r.to:direction==="backward"?r.from:r.from+1;
    if(from<0||to>length(b)) return {ok:false,reason:"Nothing to delete in that direction"};
    const p={blockId:b.id,offset:from};
    return {ok:true,transaction:{id:ids(),baseVersion:state.version,ops:[{type:"delete_text",blockId:b.id,from,to}],selection:{anchor:p,head:p},meta:txMeta(options,"text.delete"+direction)}};
  },({state})=>{if(canEditAcrossBlocks(state))return true;const r=range(state),b=r?findBlock(state,r.blockId):undefined;if(!r||!b)return false;if(r.to>r.from)return true;if(direction==="backward"&&r.from===0){const c=siblingContext(state,b.id);return !!c&&c.index>0;}if(direction==="forward"&&r.from===length(b)){const c=siblingContext(state,b.id);return !!c&&c.index+1<c.list.length;}return direction==="backward"?r.from>0:r.to<length(b);});
  const split=cmd("block.split",({state})=>{
    const cross=planCrossBlockEdit(state,{ids});
    if(cross){const newId=ids(),p={blockId:newId,offset:0};return {ok:true,transaction:{id:ids(),baseVersion:state.version,ops:[...cross.ops,{type:"split_block",id:cross.caret.blockId,offset:cross.caret.offset,newId}],selection:{anchor:p,head:p},meta:txMeta(options,"block.splitAcrossBlocks")}};}
    if(selectionSpansBlocks(state)) return {ok:false,reason:UNSUPPORTED_SPAN};
    const r=range(state),b=r?findBlock(state,r.blockId):undefined; if(!r||!b||(b.content??[]).some(isBlock)) return {ok:false,reason:"A caret in a text block is required"};
    const newId=ids(),p={blockId:newId,offset:0},ops:Transaction["ops"][number][]=[];
    if(r.to>r.from)ops.push({type:"delete_text",blockId:b.id,from:r.from,to:r.to});
    ops.push({type:"split_block",id:b.id,offset:r.from,newId});
    return {ok:true,transaction:{id:ids(),baseVersion:state.version,ops,selection:{anchor:p,head:p},meta:txMeta(options,"block.split")}};
  },({state})=>{if(canEditAcrossBlocks(state))return true;const r=range(state),b=r?findBlock(state,r.blockId):undefined;return !!r&&!!b&&!(b.content??[]).some(isBlock);});
  const setType=(type:"paragraph"|"heading")=>cmd(type==="paragraph"?"block.setParagraph":"block.setHeading",({state},args?:SetHeadingArgs)=>{
    const selected=selectedBlockRanges(state);if(!selected?.length)return {ok:false,reason:"A selection of text blocks in one section and slot is required"};
    const ops:Transaction["ops"][number][]=selected.map(({block})=>type==="heading"?{type:"set_node_type",id:block.id,nodeType:"heading",attrs:{level:args?.level??1}}:{type:"set_node_type",id:block.id,nodeType:"paragraph",attrs:{}});
    return {ok:true,transaction:{id:ids(),baseVersion:state.version,ops,meta:txMeta(options,type==="heading"?"block.setHeading":"block.setParagraph")}};
  },({state})=>!!selectedBlockRanges(state)?.length);
  const align=cmd("block.setAlignment",({state},args:SetAlignmentArgs)=>{
    const selected=selectedBlockRanges(state);if(!selected?.length||!args||!["left","center","right","justify"].includes(args.align))return {ok:false,reason:"Valid text block selection and alignment are required"};
    const ops:Transaction["ops"][number][]=selected.map(({block})=>({type:"set_attrs",id:block.id,set:{align:args.align}}));
    return {ok:true,transaction:{id:ids(),baseVersion:state.version,ops,meta:txMeta(options,"block.setAlignment")}};
  },({state})=>!!selectedBlockRanges(state)?.length);
  const mark=(id:string,type:string):CommandSpec=>cmd(id,({state})=>{
    const selected=selectedBlockRanges(state);if(!selected?.some(r=>r.to>r.from))return {ok:false,reason:"Select text across one or more text blocks to format"};
    const hasMark=selected.some(({block,from,to})=>{let pos=0;for(const node of (block.content??[]) as Inline[]){const n=isText(node)?node.text.length:1;const active=isText(node)&&(node.marks??[]).some(m=>m.type===type);if(active&&pos<to&&pos+n>from)return true;pos+=n;}return false;});
    const action=hasMark?"remove":"add";
    const ops:Transaction["ops"][number][]=selected.filter(r=>r.to>r.from).map(r=>({type:"format",blockId:r.block.id,from:r.from,to:r.to,mark:{type},action}));
    return {ok:true,transaction:{id:ids(),baseVersion:state.version,ops,meta:txMeta(options,id)}};
  },({state})=>!!selectedBlockRanges(state)?.some(r=>r.to>r.from));
  const deleteTableRow=cmd("table.deleteRow",({state})=>{
    const c=tableContext(state);if(!c||c.rows.length<2)return {ok:false,reason:"A table row in a table with at least two rows is required"};
    const neighbor=c.rows[c.rowIndex+1]??c.rows[c.rowIndex-1]!;
    const neighborCell=(neighbor.content??[]).filter(isBlock)[Math.min(c.columnIndex,(neighbor.content??[]).filter(isBlock).length-1)];
    const target=neighborCell?firstTextDescendant(neighborCell):undefined;if(!target)return {ok:false,reason:"Could not find an editable cell in the remaining table"};
    return {ok:true,transaction:{id:ids(),baseVersion:state.version,ops:[{type:"remove_block",id:c.row.id}],selection:{anchor:{blockId:target.id,offset:0},head:{blockId:target.id,offset:0}},meta:txMeta(options,"table.deleteRow")}};
  },({state})=>canDeleteTableRow(state));
  const deleteTableColumn=cmd("table.deleteColumn",({state})=>{
    const c=tableContext(state);if(!c||!canDeleteTableColumn(state))return {ok:false,reason:"Column deletion requires a rectangular table with at least two columns and no merged cells"};
    const targetColumn=c.columnIndex===c.cells.length-1?c.columnIndex-1:c.columnIndex+1;
    const targetCell=(c.rows[c.rowIndex]!.content??[]).filter(isBlock)[targetColumn]!;
    const target=firstTextDescendant(targetCell);if(!target)return {ok:false,reason:"Could not find an editable cell in the remaining table"};
    const ops:Transaction["ops"][number][]=c.rows.map(row=>({type:"remove_block",id:(row.content??[]).filter(isBlock)[c.columnIndex]!.id}));
    return {ok:true,transaction:{id:ids(),baseVersion:state.version,ops,selection:{anchor:{blockId:target.id,offset:0},head:{blockId:target.id,offset:0}},meta:txMeta(options,"table.deleteColumn")}};
  },({state})=>canDeleteTableColumn(state));
  return [insert,deleteDir("backward"),deleteDir("forward"),split,setType("paragraph"),setType("heading"),align,mark("text.toggleBold","bold"),mark("text.toggleItalic","italic"),mark("text.toggleUnderline","underline"),mark("text.toggleStrike","strike"),deleteTableRow,deleteTableColumn];
}
export function registerEditingCommands(editor:Editor,options:EditingOptions={}):()=>void {
  const offs=createEditingCommands(options).map(s=>editor.commands.register(s)); return ()=>{for(const off of offs.reverse())off();};
}
export function setSelection(editor:Editor,selection:Selection,options:EditingOptions={}) {
  return editor.dispatch({id:(options.ids??defaultIdGenerator)(),baseVersion:editor.state.version,ops:[],selection,meta:txMeta(options,"selection.set")});
}
export function getTextBlocks(state:EditorState):readonly {id:string;type:string;text:string}[] {
  const out:{id:string;type:string;text:string}[]=[];
  for(const s of state.document.sections) walk(s.content,n=>{if(["paragraph","heading","codeBlock"].includes(n.type)&&!(n.content??[]).some(isBlock))out.push({id:n.id,type:n.type,text:(n.content??[]).map(x=>isText(x as Inline)?(x as Extract<Inline,{type:"text"}>).text:"\uFFFC").join("")});return false;});
  return out;
}

export * from "./interaction";
export * from "./browser";
export * from "./pagination";
