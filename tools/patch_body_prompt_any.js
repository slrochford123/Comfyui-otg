const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "api", "comfy", "route.ts");
let s = fs.readFileSync(file, "utf8");

const before = "if (!graph && body.prompt && typeof body.prompt === \"object\") {";
const after  = "if (!graph && (body as any).prompt && typeof (body as any).prompt === \"object\") {";

if (!s.includes(before) && !s.includes(after)) {
  console.error("Anchor not found (line changed). Search manually for 'body.prompt' in:", file);
  process.exit(1);
}

s = s.replace(before, after);

// also replace the assignment line if present
s = s.replace("graph = body.prompt;", "graph = (body as any).prompt;");

fs.writeFileSync(file, s, "utf8");
console.log("Patched body.prompt -> (body as any).prompt in:", file);
