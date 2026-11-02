import fs from "node:fs";
import {expect,it} from "vitest";
it("bounds native image JSON and multipart before buffering source files",()=>{
  const source=fs.readFileSync("app/api/images/native/route.ts","utf8");
  expect(source).toContain("limitedFormData(req, 21 * 1024 * 1024)");
  expect(source).toContain("limitedJson(req, 256 * 1024)");
  expect(source).not.toContain("await req.formData()");
  expect(source.indexOf("await getOwnerContext(req)")).toBeLessThan(source.indexOf("await limitedFormData(req"));
});
