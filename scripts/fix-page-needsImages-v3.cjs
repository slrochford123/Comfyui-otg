// scripts/fix-page-needsImages-v3.cjs
// Fix: needsImages was inserted into Card() helper, but is needed in the main page component.
// This script:
//  1) Removes any accidental `const needsImages = 0;` inside Card()
//  2) Inserts `const needsImages = selectedWorkflow?.needsImages ?? 0;` inside the default-export page component.
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-page-needsImages-v3.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "app", "app", "page.tsx");
if (!fs.existsSync(filePath)) {
  console.error("[fix-page-needsImages-v3] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

// 1) Remove accidental insertion inside Card helper (exact line)
s = s.replace(/\n\s*const needsImages = 0;\s*\r?\n/, "\n");

// If needsImages already exists in main component, bail.
if (/\bconst\s+needsImages\s*=/.test(s) && s.includes("{needsImages > 0")) {
  // could still be only inside Card; we removed one above.
}

// 2) Insert into default export component.
// Find the default export function header.
const fnRe = /(export\s+default\s+function\s+[A-Za-z0-9_]*\s*\([^)]*\)\s*\{\s*\r?\n)/m;
let inserted = false;
if (fnRe.test(s)) {
  s = s.replace(fnRe, (m) => {
    inserted = true;
    return m + "  const needsImages = selectedWorkflow?.needsImages ?? 0;\n";
  });
} else {
  // Try pattern: const Page = () => { ... }; export default Page;
  const constRe = /(const\s+[A-Za-z0-9_]+\s*=\s*\([^)]*\)\s*=>\s*\{\s*\r?\n)/m;
  if (constRe.test(s)) {
    s = s.replace(constRe, (m) => {
      inserted = true;
      return m + "  const needsImages = selectedWorkflow?.needsImages ?? 0;\n";
    });
  }
}

if (!inserted) {
  console.error("[fix-page-needsImages-v3] Could not find default export component to insert into. Search for `export default` in app/app/page.tsx and add:\n  const needsImages = selectedWorkflow?.needsImages ?? 0;");
  process.exit(1);
}

fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-page-needsImages-v3] Patched needsImages placement in:", filePath);
