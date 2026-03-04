const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "api", "comfy", "route.ts");
if (!fs.existsSync(file)) {
  console.error("Missing:", file);
  process.exit(1);
}

let s = fs.readFileSync(file, "utf8");

// 1) Fix the syntax error introduced by the patcher
s = s.replace(/return\s+const\s+rawBody\s*=\s*await\s+req\.json\(\)\s*;/g, "const rawBody = await req.json();");

// 2) Remove the entire V4 injected block if present
const start = s.indexOf("// ===== OTG_COMFY_BODY_PATCH_V4 =====");
if (start !== -1) {
  const endMarker = "// ===== END OTG_COMFY_BODY_PATCH_V4 =====";
  const end = s.indexOf(endMarker, start);
  if (end !== -1) {
    const end2 = end + endMarker.length;
    s = s.slice(0, start) + s.slice(end2);
    console.log("Removed V4 block.");
  } else {
    console.log("Found V4 start but not end marker. Not removing automatically.");
  }
} else {
  console.log("No V4 block found.");
}

fs.writeFileSync(file, s, "utf8");
console.log("Fixed:", file);
