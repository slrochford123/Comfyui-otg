const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "api", "comfy", "route.ts");
let s = fs.readFileSync(file, "utf8");

// Replace body.prompts occurrences with (body as any).prompts
const before1 = "Array.isArray(body.prompts)";
const after1  = "Array.isArray((body as any).prompts)";

s = s.replaceAll(before1, after1);

// Replace body.prompts[ with (body as any).prompts[
s = s.replaceAll("body.prompts[", "(body as any).prompts[");

// Also replace any remaining direct property checks
s = s.replaceAll("body.prompts", "(body as any).prompts");

fs.writeFileSync(file, s, "utf8");
console.log("Patched body.prompts -> (body as any).prompts in:", file);
