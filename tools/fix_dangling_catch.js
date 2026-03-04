const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "api", "comfy", "route.ts");
if (!fs.existsSync(file)) {
  console.error("Missing:", file);
  process.exit(1);
}

let s = fs.readFileSync(file, "utf8");

// 1) Remove the exact broken pattern:
// const rawBody = await req.json();
// .catch(() => null);
s = s.replace(
  /const\s+rawBody\s*=\s*await\s+req\.json\(\)\s*;\s*\r?\n\s*\.catch\(\s*\(\s*\)\s*=>\s*null\s*\)\s*;\s*/g,
  "const rawBody = await req.json();\n"
);

// 2) Also remove any standalone line that is just ".catch(() => null);"
s = s.replace(/^\s*\.catch\(\s*\(\s*\)\s*=>\s*null\s*\)\s*;\s*\r?\n/gm, "");

// 3) If there is any "await req.json().catch(() => null)" (valid JS but you probably don’t want it),
// normalize it back to plain await req.json()
s = s.replace(
  /await\s+req\.json\(\)\s*\.catch\(\s*\(\s*\)\s*=>\s*null\s*\)/g,
  "await req.json()"
);

fs.writeFileSync(file, s, "utf8");
console.log("Fixed dangling .catch() in:", file);
