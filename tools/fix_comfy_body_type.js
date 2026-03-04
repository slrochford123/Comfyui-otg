const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "api", "comfy", "route.ts");
if (!fs.existsSync(file)) {
  console.error("Missing:", file);
  process.exit(1);
}

let s = fs.readFileSync(file, "utf8");

// We look for the body type declaration that includes preset/positivePrompt/negativePrompt...
// and insert prompt/prompts fields if missing.

function patchObjectType(typeName) {
  const rx = new RegExp(`type\\s+${typeName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`, "m");
  const m = s.match(rx);
  if (!m) return false;

  const block = m[0];
  if (block.includes("prompt?:") || block.includes("prompt:")) return true;

  const insert = `  prompt?: unknown;\n  prompts?: unknown;\n`;
  const patched = block.replace("{\n", "{\n" + insert);

  s = s.replace(block, patched);
  console.log("Patched type", typeName);
  return true;
}

// Common patterns
let ok = false;
ok = patchObjectType("ComfyBody") || ok;
ok = patchObjectType("Body") || ok;
ok = patchObjectType("SubmitBody") || ok;

// If we didn't find a named type, patch inline annotation: `const body: { ... } =`
if (!ok) {
  const rxInline = /const\s+body\s*:\s*\{\s*([\s\S]*?)\}\s*=\s*/m;
  const m2 = s.match(rxInline);
  if (m2) {
    const full = m2[0];
    const inside = m2[1];
    if (!inside.includes("prompt?:") && !inside.includes("prompt:")) {
      const patched = full.replace("{", "{\n  prompt?: unknown;\n  prompts?: unknown;\n");
      s = s.replace(full, patched);
      console.log("Patched inline body type");
      ok = true;
    }
  }
}

if (!ok) {
  // Last resort: widen body typing by removing annotation `: { ... }`
  s = s.replace(/const\s+body\s*:\s*\{[\s\S]*?\}\s*=\s*/m, "const body = ");
  console.log("Widened body typing (removed inline annotation).");
}

fs.writeFileSync(file, s, "utf8");
console.log("DONE:", file);
