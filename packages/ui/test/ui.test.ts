import {describe,expect,it} from "vitest";
import {createDocument,createEditor,createNodeFactory,createSequentialIdGenerator} from "@convetlib/core";
import {registerEditingCommands,setSelection} from "@convetlib/editor";
import {DEFAULT_TOOLBAR,getToolbarState} from "../src/index";
describe("framework-neutral toolbar model",()=>{it("reflects command availability and current selection",async()=>{const ids=createSequentialIdGenerator(),f=createNodeFactory(ids),ed=await createEditor({document:createDocument({ids,content:[f.paragraph("hello")]}),ids});registerEditingCommands(ed,{ids});const b=ed.state.document.sections[0]!.content[0]!;setSelection(ed,{anchor:{blockId:b.id,offset:1},head:{blockId:b.id,offset:4}},{ids});const toolbar=getToolbarState(ed);expect(toolbar.find(x=>x.id==="bold")?.enabled).toBe(true);expect(toolbar.find(x=>x.id==="heading-1")?.enabled).toBe(true);expect(DEFAULT_TOOLBAR.length).toBeGreaterThan(5);await ed.destroy();});});
