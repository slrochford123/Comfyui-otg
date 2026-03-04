const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "api", "comfy", "route.ts");
if (!fs.existsSync(file)) {
  console.error("Missing:", file);
  process.exit(1);
}

let s = fs.readFileSync(file, "utf8");
if (s.includes("OTG_COMFY_BODY_PATCH_V3")) {
  console.log("Already patched:", file);
  process.exit(0);
}

// Find the first occurrence of: await req.json()
const m = s.match(/await\s+req\.json\s*\(\s*\)\s*;?/);
if (!m) {
  console.error("Could not find 'await req.json()' in file. Patch manually.");
  process.exit(2);
}

const marker = "OTG_COMFY_BODY_PATCH_V3";
const inject = `
// ===== ${marker} =====
// Normalize incoming body so frontend can send { positivePrompt, negativePrompt, prompts:null }
const __raw = rawBody ?? body ?? {};
const positivePrompt = typeof __raw.positivePrompt === "string" ? __raw.positivePrompt : "";
const negativePrompt = typeof __raw.negativePrompt === "string" ? __raw.negativePrompt : "";
const prompts = Array.isArray(__raw.prompts)
  ? __raw.prompts
  : (positivePrompt ? [{ positive: positivePrompt, negative: negativePrompt }] : []);
const normalizedBody = { ...__raw, positivePrompt, negativePrompt, prompts };

// If the route later validates `body`, force it to validate normalizedBody instead.
const body = normalizedBody;
const rawBody = normalizedBody;

// Minimum acceptance (prevents "Invalid request body" when prompts is null but positivePrompt exists)
if ((!Array.isArray(body.prompts) || body.prompts.length === 0) && !body.positivePrompt) {
  return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });
}
// ===== END ${marker} =====
`;

// We will:
// 1) Replace FIRST `await req.json()` statement with: `const rawBody = await req.json();`
// 2) Then inject the normalization block right after it.

let replaced = false;
s = s.replace(/await\s+req\.json\s*\(\s*\)\s*;?/ , (match) => {
  replaced = true;
  return `const rawBody = ${match.replace(/;?$/, ";")}`;
});

if (!replaced) {
  console.error("Failed to replace req.json()");
  process.exit(3);
}

// Insert injection right after the new `const rawBody = await req.json();`
const anchor = "const rawBody = await req.json();";
const idx = s.indexOf(anchor);
if (idx === -1) {
  console.error("Anchor not found after replacement.");
  process.exit(4);
}
const insertAt = idx + anchor.length;
s = s.slice(0, insertAt) + "\n" + inject + s.slice(insertAt);

// If there are zod validations like safeParse(rawBody) or safeParse(body), force them to use `body` (now normalized).
s = s.replace(/safeParse\(\s*rawBody\s*\)/g, "safeParse(body)");
s = s.replace(/safeParse\(\s*body\s*\)/g, "safeParse(body)");

fs.writeFileSync(file, s, "utf8");
console.log("Patched:", file);
