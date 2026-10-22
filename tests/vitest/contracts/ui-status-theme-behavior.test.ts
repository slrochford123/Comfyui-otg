import {describe,it,expect} from "vitest";
import fs from "node:fs";
import {uiStatusTone} from "@/lib/uiStatusTone";
describe("Truthful status tones and shared accent",()=>{
 it.each(["Comfy connected: Connected.","Story Helper answered.","Saved successfully."])("does not style success as a failure: %s",message=>expect(uiStatusTone(message)).toBe("success"));
 it.each(["Comfy disconnected.","Unable to connect.","Save failed.","Worker not ready."])("retains red for real errors: %s",message=>expect(uiStatusTone(message)).toBe("error"));
 it("distinguishes pending cancellation",()=>expect(uiStatusTone("Cancel requested; waiting for backend.")).toBe("warning"));
 it("uses palette tokens for selected H3 options and primary actions",()=>{
  const source=fs.readFileSync("app/app/components/H3Panel.tsx","utf8");
  expect(source).toContain("!bg-[var(--color-primary-muted)]");
  expect(source).toContain("!text-[var(--color-primary-foreground)]");
  expect(source).not.toContain("Dedicated TEST mode");
  expect(source).not.toContain("TEST single-person");
 });
});
