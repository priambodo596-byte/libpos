import { describe, expect, it } from "vitest";
import { createDocument, createEditor, createNodeFactory, createSequentialIdGenerator, type BlockNode } from "@convetlib/core";
import { getTextBlocks, registerEditingCommands, setSelection, handleKeyboardShortcut, copySelection, cutSelection, pastePlainText, pasteClipboardPayload, htmlToClipboardPayload, handleClipboardShortcut, createCompositionBuffer, getEditorAccessibilityProps } from "../src/index";

describe("Stage 3 interaction contracts", () => {
  it("replaces a selection spanning paragraphs", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const ed=await createEditor({document:createDocument({ids,content:[f.paragraph("Hello"),f.paragraph("middle"),f.paragraph("world")]}),ids});
    registerEditingCommands(ed,{ids});
    const blocks=ed.state.document.sections[0]!.content;
    setSelection(ed,{anchor:{blockId:blocks[0]!.id,offset:2},head:{blockId:blocks[2]!.id,offset:3}},{ids});
    expect(ed.commands.execute("text.insert",{text:"X"}).ok).toBe(true);
    expect(getTextBlocks(ed.state).map(b=>b.text)).toEqual(["HeXld"]);
    expect(ed.state.selection?.head).toEqual({blockId:blocks[0]!.id,offset:3});
    await ed.destroy();
  });
  it("deletes across paragraphs inside a table cell context", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const table=f.table([["first"]]);
    const row=table.content![0] as BlockNode;
    const cell=row.content![0] as BlockNode;
    const paras=[f.paragraph("first"),f.paragraph("second"),f.paragraph("third")];
    cell.content=paras;
    const ed=await createEditor({document:createDocument({ids,content:[table]}),ids});
    registerEditingCommands(ed,{ids});
    setSelection(ed,{anchor:{blockId:paras[0]!.id,offset:1},head:{blockId:paras[2]!.id,offset:2}},{ids});
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(getTextBlocks(ed.state).map(b=>b.text)).toEqual(["fird"]);
    await ed.destroy();
  });
  it("joins adjacent paragraphs with backspace at the start of a paragraph", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const ed=await createEditor({document:createDocument({ids,content:[f.paragraph("One"),f.paragraph("Two")]}),ids});
    registerEditingCommands(ed,{ids});
    const [a,b]=ed.state.document.sections[0]!.content;
    setSelection(ed,{anchor:{blockId:b!.id,offset:0},head:{blockId:b!.id,offset:0}},{ids});
    expect(ed.commands.execute("text.deleteBackward").ok).toBe(true);
    expect(getTextBlocks(ed.state).map(x=>x.text)).toEqual(["OneTwo"]);
    expect(ed.state.selection?.head).toEqual({blockId:a!.id,offset:3});
    await ed.destroy();
  });
  it("maps keyboard shortcuts and avoids intercepting active IME composition", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const ed=await createEditor({document:createDocument({ids,content:[f.paragraph("Text")]}),ids});
    registerEditingCommands(ed,{ids});
    const first=ed.state.document.sections[0]!.content[0]!;
    setSelection(ed,{anchor:{blockId:first.id,offset:2},head:{blockId:first.id,offset:2}},{ids});
    let prevented=0;
    expect(handleKeyboardShortcut(ed,{key:"Enter",preventDefault(){prevented++;}}).handled).toBe(true);
    expect(prevented).toBe(1);
    expect(handleKeyboardShortcut(ed,{key:"b",ctrlKey:true,isComposing:true}).handled).toBe(false);
    await ed.destroy();
  });
  it("copies, cuts and pastes plain text from a selection", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const ed=await createEditor({document:createDocument({ids,content:[f.paragraph("Hello world")]}),ids});
    registerEditingCommands(ed,{ids});
    const b=ed.state.document.sections[0]!.content[0]!;
    setSelection(ed,{anchor:{blockId:b.id,offset:0},head:{blockId:b.id,offset:5}},{ids});
    expect(copySelection(ed)?.text).toBe("Hello");
    expect(cutSelection(ed)?.text).toBe("Hello");
    expect(getTextBlocks(ed.state)[0]!.text).toBe(" world");
    expect(pastePlainText(ed,"Hi")).toBe(true);
    expect(getTextBlocks(ed.state)[0]!.text).toBe("Hi world");
    await ed.destroy();
  });
  it("buffers IME updates and exposes accessible host semantics", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const ed=await createEditor({document:createDocument({ids,content:[f.paragraph("A")]}),ids});
    registerEditingCommands(ed,{ids});
    const b=ed.state.document.sections[0]!.content[0]!;
    setSelection(ed,{anchor:{blockId:b.id,offset:1},head:{blockId:b.id,offset:1}},{ids});
    const ime=createCompositionBuffer(ed); ime.start(); ime.update("に"); ime.update("日本"); expect(ime.end()).toBe(true);
    expect(getTextBlocks(ed.state)[0]!.text).toBe("A日本");
    expect(getEditorAccessibilityProps({label:"Document editor",readOnly:false})).toMatchObject({role:"textbox","aria-label":"Document editor","aria-multiline":true,"aria-readonly":false});
    await ed.destroy();
  });
});
describe("clipboard keyboard bridge", () => {
  it("routes Ctrl+C to the injected clipboard bridge", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const ed=await createEditor({document:createDocument({ids,content:[f.paragraph("Copy me")]}),ids});
    registerEditingCommands(ed,{ids});
    const b=ed.state.document.sections[0]!.content[0]!;
    setSelection(ed,{anchor:{blockId:b.id,offset:0},head:{blockId:b.id,offset:4}},{ids});
    let copied="", prevented=0;
    const result=await handleClipboardShortcut(ed,{key:"c",ctrlKey:true,preventDefault(){prevented++;}},{async readText(){return copied;},async writeText(value){copied=value;}});
    expect(result.handled).toBe(true); expect(copied).toBe("Copy"); expect(prevented).toBe(1);
    await ed.destroy();
  });
});
describe("selection edge cases", () => {
  it("copies text selections across different parent lists when structural planning supports them", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const list=f.bulletList([[f.paragraph("inside")]]);
    const outside=f.paragraph("outside");
    const ed=await createEditor({document:createDocument({ids,content:[list,outside]}),ids});
    registerEditingCommands(ed,{ids});
    const item=list.content![0] as BlockNode;
    const nested=item.content![0] as BlockNode;
    setSelection(ed,{anchor:{blockId:nested.id,offset:1},head:{blockId:outside.id,offset:2}},{ids});
    expect(copySelection(ed)?.text).toBe("nside\nou");
    await ed.destroy();
  });
  it("replaces selected text before splitting a paragraph", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const ed=await createEditor({document:createDocument({ids,content:[f.paragraph("Hello world")]}),ids});
    registerEditingCommands(ed,{ids});
    const b=ed.state.document.sections[0]!.content[0]!;
    setSelection(ed,{anchor:{blockId:b.id,offset:5},head:{blockId:b.id,offset:0}},{ids});
    expect(ed.commands.execute("block.split").ok).toBe(true);
    expect(getTextBlocks(ed.state).map(x=>x.text)).toEqual([""," world"]);
    await ed.destroy();
  });
});

describe("rich clipboard fragment", () => {
  it("preserves inline marks when pasting an internal text fragment", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const source=f.paragraph([f.text("Bold",[{type:"bold"}])]);
    const target=f.paragraph("target");
    const ed=await createEditor({document:createDocument({ids,content:[source,target]}),ids});
    registerEditingCommands(ed,{ids});
    setSelection(ed,{anchor:{blockId:source.id,offset:0},head:{blockId:source.id,offset:4}},{ids});
    const payload=copySelection(ed)!;
    expect(payload.mime).toBe("application/x-convetlib-fragment+json");
    expect(payload.runs?.[0]?.marks).toEqual([{type:"bold"}]);
    setSelection(ed,{anchor:{blockId:target.id,offset:0},head:{blockId:target.id,offset:0}},{ids});
    expect(pasteClipboardPayload(ed,payload)).toBe(true);
    const updated=ed.state.document.sections[0]!.content[1] as BlockNode;
    expect(updated.content?.[0]).toMatchObject({type:"text",text:"Bold",marks:[{type:"bold"}]});
    await ed.destroy();
  });
});

describe("paragraph-aware rich clipboard", () => {
  it("copies selections across nested parents while preserving paragraph and mark structure", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const intro=f.paragraph("intro"), list=f.bulletList(["one",[f.paragraph([f.text("two",[{type:"italic"}])])]]);
    const ed=await createEditor({document:createDocument({ids,content:[intro,list]}),ids});
    registerEditingCommands(ed,{ids});
    const item=list.content![1] as BlockNode, nested=item.content![0] as BlockNode;
    setSelection(ed,{anchor:{blockId:intro.id,offset:2},head:{blockId:nested.id,offset:1}},{ids});
    const payload=copySelection(ed)!;
    expect(payload.text).toBe("tro\none\nt");
    expect(payload.blocks).toHaveLength(3);
    expect(payload.blocks?.[2]?.runs[0]?.marks).toEqual([{type:"italic"}]);
    expect(payload.html).toContain("<em>t</em>");
    await ed.destroy();
  });

  it("pastes a multi-paragraph rich fragment into a paragraph and keeps the original suffix", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const source=[f.paragraph([f.text("First",[{type:"bold"}])]),f.paragraph([f.text("Middle",[{type:"italic"}])]),f.paragraph("Last")];
    const target=f.paragraph("tail");
    const ed=await createEditor({document:createDocument({ids,content:[...source,target]}),ids});
    registerEditingCommands(ed,{ids});
    setSelection(ed,{anchor:{blockId:source[0]!.id,offset:0},head:{blockId:source[2]!.id,offset:4}},{ids});
    const payload=copySelection(ed)!;
    setSelection(ed,{anchor:{blockId:target.id,offset:2},head:{blockId:target.id,offset:2}},{ids});
    expect(pasteClipboardPayload(ed,payload)).toBe(true);
    const blocks=ed.state.document.sections[0]!.content;
    expect(getTextBlocks(ed.state).map(b=>b.text)).toEqual(["First","Middle","Last","taFirst","Middle","Lastil"]);
    expect((blocks[4] as BlockNode).content?.[0]).toMatchObject({text:"Middle",marks:[{type:"italic"}]});
    expect(ed.state.selection?.head).toEqual({blockId:(blocks[5] as BlockNode).id,offset:4});
    await ed.destroy();
  });

  it("imports basic HTML formatting but strips script content and attributes", () => {
    const payload=htmlToClipboardPayload('<p onclick="run()"><strong>Safe</strong><script>alert(1)</script><img src="x"></p>');
    expect(payload?.text).toBe("Safe");
    expect(payload?.blocks?.[0]?.runs).toEqual([{text:"Safe",marks:[{type:"bold"}]}]);
    expect(payload?.html).not.toContain("script");
    expect(payload?.html).not.toContain("onclick");
  });
});

  it("cuts a supported selection across nested parent boundaries atomically", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const intro=f.paragraph("intro"), list=f.bulletList(["one","two"]);
    const ed=await createEditor({document:createDocument({ids,content:[intro,list]}),ids});
    registerEditingCommands(ed,{ids});
    const item=list.content![1] as BlockNode, tail=item.content![0] as BlockNode;
    setSelection(ed,{anchor:{blockId:intro.id,offset:2},head:{blockId:tail.id,offset:1}},{ids});
    const payload=cutSelection(ed);
    expect(payload?.text).toBe("tro\none\nt");
    expect(getTextBlocks(ed.state).map(b=>b.text)).toEqual(["inwo"]);
    await ed.destroy();
  });

describe("multi-block formatting", () => {
  it("applies and toggles inline marks across a selection spanning paragraphs", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const first=f.paragraph("alpha"), second=f.paragraph("bravo"), third=f.paragraph("charlie");
    const ed=await createEditor({document:createDocument({ids,content:[first,second,third]}),ids});
    registerEditingCommands(ed,{ids});
    setSelection(ed,{anchor:{blockId:first.id,offset:2},head:{blockId:third.id,offset:3}},{ids});
    expect(ed.commands.execute("text.toggleBold").ok).toBe(true);
    const blocks=ed.state.document.sections[0]!.content as BlockNode[];
    const hasBold=(block:BlockNode,text:string)=>(block.content??[]).some(raw=>{const n=raw as {type:string;text?:string;marks?:Array<{type:string}>};return n.type==="text"&&n.text===text&&n.marks?.some(m=>m.type==="bold");});
    expect(hasBold(blocks[0]!,"pha")).toBe(true);
    expect(hasBold(blocks[1]!,"bravo")).toBe(true);
    expect(hasBold(blocks[2]!,"cha")).toBe(true);
    expect(ed.commands.execute("text.toggleBold").ok).toBe(true);
    expect(((ed.state.document.sections[0]!.content[1] as BlockNode).content??[]).every(raw=>{const n=raw as {type:string;marks?:Array<{type:string}>};return n.type!=="text"||!n.marks?.some(m=>m.type==="bold");})).toBe(true);
    await ed.destroy();
  });

  it("applies heading conversion and alignment to all selected text blocks", async () => {
    const ids=createSequentialIdGenerator(), f=createNodeFactory(ids);
    const first=f.paragraph("alpha"), second=f.paragraph("bravo");
    const ed=await createEditor({document:createDocument({ids,content:[first,second]}),ids});
    registerEditingCommands(ed,{ids});
    setSelection(ed,{anchor:{blockId:first.id,offset:1},head:{blockId:second.id,offset:3}},{ids});
    expect(ed.commands.execute("block.setHeading",{level:2}).ok).toBe(true);
    expect(ed.commands.execute("block.setAlignment",{align:"center"}).ok).toBe(true);
    const blocks=ed.state.document.sections[0]!.content as BlockNode[];
    expect(blocks.map(b=>b.type)).toEqual(["heading","heading"]);
    expect(blocks.map(b=>b.attrs?.align)).toEqual(["center","center"]);
    expect(blocks.map(b=>b.attrs?.level)).toEqual([2,2]);
    await ed.destroy();
  });
});
