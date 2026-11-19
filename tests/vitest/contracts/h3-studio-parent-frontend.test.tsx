// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import H3Panel from "@/app/app/components/H3Panel";
const json = (value: unknown) => new Response(JSON.stringify(value));
beforeEach(() => {
  localStorage.clear();
  const NativeURL = URL;
  vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL: vi.fn(() => "blob:source"), revokeObjectURL: vi.fn() }));
  vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true, catalog: [], entries: [], maxSelections: 3 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("current H3 parent integration",()=>{
 it("opens the familiar generation controls with one selected Text method",async()=>{render(<H3Panel authenticatedOwnerKey="qa"/>);expect(screen.getByRole("button",{name:"Text",exact:true})).toHaveAttribute("aria-pressed","true");expect(screen.getByLabelText("Scene description")).toBeVisible();expect(screen.getByRole("button",{name:/Add Prompt and Required Inputs/})).toBeDisabled();});
 it("keeps the scene draft when switching to structured Manual and back",async()=>{render(<H3Panel authenticatedOwnerKey="qa"/>);const scene=screen.getByLabelText("Scene description");fireEvent.change(scene,{target:{value:"A friendly adult firefighter checks a hose."}});fireEvent.click(screen.getByRole("button",{name:"Manual",exact:true}));expect(scene).not.toBeVisible();expect(screen.getByRole("combobox",{name:"Workflow"})).toBeVisible();fireEvent.click(screen.getByRole("button",{name:"Text",exact:true}));expect(scene).toBeVisible();expect(scene).toHaveValue("A friendly adult firefighter checks a hose.");});
 it("does not submit a render when browsing modes",async()=>{const fetcher=vi.mocked(fetch);render(<H3Panel authenticatedOwnerKey="qa"/>);for(const name of ["Image","Reference","Text"]){fireEvent.click(screen.getByRole("button",{name,exact:true}));}await waitFor(()=>expect(fetcher).toHaveBeenCalled());expect(fetcher.mock.calls.filter(([,options])=>options?.method==="POST"&&String(options.body).includes('"action":"generate"'))).toHaveLength(0);});
 it("keeps optional Manual separate from the result workflow",async()=>{render(<H3Panel authenticatedOwnerKey="qa"/>);fireEvent.click(screen.getByRole("button",{name:"Manual",exact:true}));expect(screen.getByRole("button",{name:"Manual",exact:true})).toHaveAttribute("aria-pressed","true");fireEvent.click(screen.getByRole("button",{name:"Reference",exact:true}));expect(screen.getByRole("button",{name:"Reference",exact:true})).toHaveAttribute("aria-pressed","true");expect(screen.getByRole("button",{name:"Manual",exact:true})).toHaveAttribute("aria-pressed","false");});
 it("retains the qualified Edit Video tools in their existing area",async()=>{render(<H3Panel authenticatedOwnerKey="qa" isAdmin/>);fireEvent.click(screen.getByRole("button",{name:"Edit Video",exact:true}));for(const name of ["Edit","Body Swap","Character Swap","Character Swapping V2","RefMod Character Swap"]){expect(screen.getByRole("button",{name,exact:true})).toBeVisible();}expect(screen.getByRole("group",{name:"Megapixel size"})).toBeVisible();});
});
