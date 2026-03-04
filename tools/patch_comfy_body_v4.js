const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "api", "comfy", "route.ts");
if (!fs.existsSync(file)) {
  console.error("Missing:", file);
  process.exit(1);
}

let s = fs.readFileSync(file, "utf8");
if (s.includes("OTG_COMFY_BODY_PATCH_V4")) {
  console.log("Already patched:", file);
  process.exit(0);
}

// Find first "await req.json()"
const rx = /await\s+req\.json\s*\(\s*\)\s*;?/;
const m = s.match(rx);
if (!m) {
  console.error("Could not find await req.json() in file. Patch manually.");
  process.exit(2);
}

// Replace the FIRST await req.json() with: const rawBody = await req.json();
let replaced = false;
s = s.replace(rx, (match) => {
  replaced = true;
  // ensure semicolon
  const stmt = match.endsWith(";") ? match : (match + ";");
  return "const rawBody = " + stmt;
});
if (!replaced) {
  console.error("Failed to replace req.json()");
  process.exit(3);
}

const marker = "OTG_COMFY_BODY_PATCH_V4";
const injectLines = [
  "",
  "// ===== " + marker + " =====",
  "// Normalize incoming body so frontend can send { positivePrompt, negativePrompt, prompts:null }",
  "const __raw = (typeof rawBody === 'object' && rawBody) ? rawBody : {};",
  "const positivePrompt = (typeof __raw.positivePrompt === 'string') ? __raw.positivePrompt : '';",
  "const negativePrompt = (typeof __raw.negativePrompt === 'string') ? __raw.negativePrompt : '';",
  "const prompts = Array.isArray(__raw.prompts) ? __raw.prompts : (positivePrompt ? [{ positive: positivePrompt, negative: negativePrompt }] : []);",
  "const normalizedBody = { ...__raw, positivePrompt, negativePrompt, prompts };",
  "",
  "// Force downstream code to see normalized values",
  "const body = normalizedBody;",
  "const rawBody2 = normalizedBody; // alias to avoid redeclare conflicts if rawBody is referenced later",
  "",
  "// Minimum acceptance: either prompts array OR positivePrompt string",
  "if ((!Array.isArray(body.prompts) || body.prompts.length === 0) && !body.positivePrompt) {",
  "  return Response.json({ ok: false, error: 'Invalid request body' }, { status: 400 });",
  "}",
  "// ===== END " + marker + " =====",
  ""
].join("\n");

// Insert injection after the first occurrence of "const rawBody = await req.json();"
const anchor = "const rawBody = await req.json();";
const idx = s.indexOf(anchor);
if (idx === -1) {
  console.error("Anchor not found after replacement (unexpected).");
  process.exit(4);
}
const insertAt = idx + anchor.length;
s = s.slice(0, insertAt) + injectLines + s.slice(insertAt);

// If there is zod validation, force it to validate normalized `body`
// best-effort replacements:
s = s.replace(/safeParse\(\s*rawBody\s*\)/g, "safeParse(body)");
s = s.replace(/safeParse\(\s*body\s*\)/g, "safeParse(body)");
s = s.replace(/parse\(\s*rawBody\s*\)/g, "parse(body)");
s = s.replace(/parse\(\s*body\s*\)/g, "parse(body)");

// If code references `rawBody` later, redirect to rawBody2 without breaking earlier insertion
// (only after our patch marker)
const split = s.split(marker);
if (split.length >= 2) {
  const head = split[0] + marker;
  const tail = split.slice(1).join(marker).replace(/\brawBody\b/g, "rawBody2");
  s = head + tail;
}

fs.writeFileSync(file, s, "utf8");
console.log("Patched:", file);
