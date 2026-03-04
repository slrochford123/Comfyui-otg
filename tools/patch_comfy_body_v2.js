const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const target = path.join(ROOT, "app", "api", "comfy", "route.ts");
if (!fs.existsSync(target)) {
  console.log("Missing:", target);
  process.exit(1);
}

let s = fs.readFileSync(target, "utf8");
if (s.includes("OTG_COMFY_BODY_PATCH_V2")) {
  console.log("Already patched:", target);
  process.exit(0);
}

// 1) ensure we read json into rawBody
s = s.replace(
  /const\s+body\s*=\s*await\s+req\.json\(\)\s*;/,
  "const rawBody = await req.json();\n"
);

// 2) if route already uses rawBody name, don't duplicate
if (!s.includes("const rawBody = await req.json()")) {
  s = s.replace(
    /await\s+req\.json\(\)\s*;/,
    "const rawBody = await req.json();"
  );
}

// 3) inject normalization + relaxed validation immediately after json read
const marker = "OTG_COMFY_BODY_PATCH_V2";
const inject = `
// ===== ${marker} =====
const body = (() => {
  const b = (typeof rawBody === "object" && rawBody) ? rawBody : {};
  const pos = typeof b.positivePrompt === "string" ? b.positivePrompt : "";
  const neg = typeof b.negativePrompt === "string" ? b.negativePrompt : "";
  const promptsArr = Array.isArray(b.prompts) ? b.prompts : (pos ? [{ positive: pos, negative: neg }] : []);
  return { ...b, positivePrompt: pos, negativePrompt: neg, prompts: promptsArr };
})();

// Minimum acceptance: either prompts array OR positivePrompt string
if ((!Array.isArray(body.prompts) || body.prompts.length === 0) && !body.positivePrompt) {
  return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });
}
// ===== END ${marker} =====
`;

// place injection after the first occurrence of rawBody assignment
const idx = s.indexOf("const rawBody = await req.json()");
if (idx === -1) {
  console.log("Could not find rawBody assignment anchor. Open file and patch manually.");
  process.exit(2);
}
const endLineIdx = s.indexOf("\n", idx);
s = s.slice(0, endLineIdx+1) + inject + s.slice(endLineIdx+1);

// 4) any later references to "rawBody" validation should use "body" now.
// If the file still declares "const body = await req.json()", remove it.
s = s.replace(/const\s+body\s*=\s*await\s+req\.json\(\)\s*;\s*/g, "");

// 5) If there is a zod schema validation that returns Invalid request body, weaken it by validating "body" not rawBody.
// (best-effort replace: safeParse(rawBody) -> safeParse(body))
s = s.replace(/safeParse\(\s*rawBody\s*\)/g, "safeParse(body)");
s = s.replace(/safeParse\(\s*body\s*\)/g, "safeParse(body)");

fs.writeFileSync(target, s, "utf8");
console.log("Patched:", target);
