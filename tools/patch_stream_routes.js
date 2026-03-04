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

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.writeFileSync(p, s, "utf8"); }

const files = walk(path.join(ROOT, "app")).filter(p => p.endsWith("route.ts"));

const targets = [];
for (const f of files) {
  const s = read(f);
  if (s.includes("new ReadableStream") && (s.includes("controller.close") || s.includes("controller.enqueue"))) {
    targets.push(f);
  }
}

console.log("ReadableStream route candidates:", targets.length);
targets.forEach(f => console.log(" -", f));

let patched = 0;

for (const f of targets) {
  let s = read(f);

  // skip if already patched
  if (s.includes("const safeClose") || s.match(/\blet\s+closed\s*=\s*false\b/)) {
    console.log("SKIP already patched:", f);
    continue;
  }

  // inject safe helpers immediately after start(controller) {
  // supports both "start(controller) {" and "start(controller){" forms
  const reStart = /(start\s*\(\s*controller\s*\)\s*\{\s*)/m;
  if (!reStart.test(s)) {
    console.log("WARN no start(controller) anchor:", f);
    continue;
  }

  s = s.replace(
    reStart,
    `$1
      let closed = false;
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {}
      };
      const safeEnqueue = (chunk) => {
        if (closed) return;
        try { controller.enqueue(chunk); } catch {}
      };

`
  );

  // replace enqueue/close calls
  s = s.replace(/controller\.enqueue\(/g, "safeEnqueue(");
  s = s.replace(/controller\.close\(\)/g, "safeClose()");

  // controller.error(...) -> try + safeClose
  s = s.replace(/controller\.error\(([^)]*)\);\s*/g, "try { controller.error($1); } catch {} safeClose();\n");

  write(f, s);
  console.log("PATCHED:", f);
  patched++;
}

console.log("DONE. Patched routes:", patched);
