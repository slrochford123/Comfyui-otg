const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
function walk(dir, out=[]) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const all = walk(path.join(ROOT, "app")).filter(p => p.endsWith("route.ts"));
const hits = all.filter(p => p.replace(/\\/g,"/").includes("/api/comfy/route.ts"));

console.log("Found api/comfy route.ts files:", hits.length);
hits.forEach(p => console.log(" -", p));

for (const p of hits) {
  const s = fs.readFileSync(p,"utf8");
  const hasZod = /zod|safeParse|parse\(/.test(s);
  const hasInvalid = /Invalid request body/.test(s);
  console.log("\n===", p);
  console.log("contains Invalid request body:", hasInvalid);
  console.log("contains zod/safeParse:", hasZod);
}
