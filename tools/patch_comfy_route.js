const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "api", "comfy", "route.ts");

if (!fs.existsSync(file)) {
  console.log("Could not find:", file);
  process.exit(1);
}

let s = fs.readFileSync(file, "utf8");

if (s.includes("SAFE_BODY_NORMALIZED")) {
  console.log("Already patched.");
  process.exit(0);
}

const injection = `
// ===== SAFE_BODY_NORMALIZED =====
function normalizeBody(body: any) {
  if (!body) return {};

  return {
    ...body,
    positivePrompt: body.positivePrompt || "",
    negativePrompt: body.negativePrompt || "",
    prompts: Array.isArray(body.prompts)
      ? body.prompts
      : body.positivePrompt
      ? [{ positive: body.positivePrompt, negative: body.negativePrompt || "" }]
      : [],
  };
}
// ===== END SAFE_BODY_NORMALIZED =====
`;

s = s.replace(
  /export async function POST\s*\(\s*req\s*:\s*Request\s*\)\s*{/,
  match => match + "\n\n" + injection
);

s = s.replace(
  /const\s+body\s*=\s*await\s+req\.json\(\);/,
  `
const rawBody = await req.json();
const body = normalizeBody(rawBody);
`
);

fs.writeFileSync(file, s, "utf8");

console.log("Patched /api/comfy route successfully.");
