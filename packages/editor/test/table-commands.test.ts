import { describe, expect, it } from "vitest";
import { createDocument, createEditor, createNodeFactory, createSequentialIdGenerator, type BlockNode } from "@convetlib/core";
import { registerEditingCommands, setSelection } from "../src/index";

function descendants(node: BlockNode): BlockNode[] {
  return [node, ...(node.content ?? []).filter((x): x is BlockNode => typeof (x as BlockNode).id === "string").flatMap(descendants)];
}
async function setup(rows: string[][], mergedFirstCell = false) {
  const ids=createSequentialIdGenerator("table"),f=createNodeFactory(ids),table=f.table(rows);
  if(mergedFirstCell){const row=(table.content??[])[0] as BlockNode;const cell=(row.content??[])[0] as BlockNode;cell.attrs={...(cell.attrs??{}),colspan:2};}
  const editor=await createEditor({document:createDocument({ids,content:[table]}),ids});
  registerEditingCommands(editor,{ids});
  const tableNode=editor.state.document.sections[0]!.content[0]!;
  const firstCellText=descendants(tableNode).find(n=>n.type==="paragraph")!;
  setSelection(editor,{anchor:{blockId:firstCellText.id,offset:0},head:{blockId:firstCellText.id,offset:0}},{ids});
  return {editor,tableNode,firstCellText};
}

describe("table row and column deletion semantics",()=>{
  it("deletes the active row and moves selection to a surviving cell",async()=>{
    const {editor,tableNode,firstCellText}=await setup([["A","B"],["C","D"],["E","F"]]);
    const rows=()=> (editor.state.document.sections[0]!.content[0]!.content??[]).filter((n):n is BlockNode=>typeof (n as BlockNode).id==="string");
    expect(editor.commands.can("table.deleteRow")).toBe(true);
    expect(editor.commands.execute("table.deleteRow").ok).toBe(true);
    expect(rows()).toHaveLength(2);
    expect(descendants(rows()[0]!).some(n=>n.id===firstCellText.id)).toBe(false);
    expect(editor.state.selection?.anchor.blockId).not.toBe(firstCellText.id);
    await editor.destroy();
  });

  it("refuses to delete the last row because tables require at least one row",async()=>{
    const {editor,tableNode}=await setup([["A","B"]]);
    expect(editor.commands.can("table.deleteRow")).toBe(false);
    expect(editor.commands.execute("table.deleteRow").ok).toBe(false);
    expect((tableNode.content??[]).filter((n):n is BlockNode=>typeof (n as BlockNode).id==="string")).toHaveLength(1);
    await editor.destroy();
  });

  it("deletes the active column from every row and preserves a rectangular table",async()=>{
    const {editor,tableNode}=await setup([["A","B","C"],["D","E","F"]]);
    expect(editor.commands.can("table.deleteColumn")).toBe(true);
    expect(editor.commands.execute("table.deleteColumn").ok).toBe(true);
    const rows=(editor.state.document.sections[0]!.content[0]!.content??[]).filter((n):n is BlockNode=>typeof (n as BlockNode).id==="string");
    expect(rows.map(r=>(r.content??[]).filter((n):n is BlockNode=>typeof (n as BlockNode).id==="string").length)).toEqual([2,2]);
    expect(editor.state.document.sections[0]!.content[0]!.type).toBe("table");
    await editor.destroy();
  });

  it("refuses column deletion for ragged rows",async()=>{
    const {editor}=await setup([["A","B"],["C"]]);
    expect(editor.commands.can("table.deleteColumn")).toBe(false);
    expect(editor.commands.execute("table.deleteColumn").ok).toBe(false);
    await editor.destroy();
  });

  it("refuses column deletion when merged cells need span-aware semantics",async()=>{
    const {editor}=await setup([["A","B"],["C","D"]],true);
    expect(editor.commands.can("table.deleteColumn")).toBe(false);
    expect(editor.commands.execute("table.deleteColumn").ok).toBe(false);
    await editor.destroy();
  });
});
