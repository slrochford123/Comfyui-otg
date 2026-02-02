// scripts/fix-contentstate-remove-title-workflow.cjs
// Fix TS error: 'title' (and often 'workflowId') do not exist in type 'ContentState'.
// Remove default fields `title:` and `workflowId:` from the fallback object in lib/contentState.ts.
//
// Usage:
//   cd C:\AI\OTG-Test\OTG
//   node scripts/fix-contentstate-remove-title-workflow.cjs
//   npm run build

const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "lib", "contentState.ts");
if (!fs.existsSync(filePath)) {
  console.error("[fix-contentstate-remove-title-workflow] Not found:", filePath);
  process.exit(1);
}

let s = fs.readFileSync(filePath, "utf8");

let changed = false;

// remove lines like: title: null,
s = s.replace(/^\s*title\s*:\s*[^,]*,\s*\r?\n/mg, () => {
  changed = true;
  return "";
});

// remove lines like: workflowId: null,
s = s.replace(/^\s*workflowId\s*:\s*[^,]*,\s*\r?\n/mg, () => {
  changed = true;
  return "";
});

if (!changed) {
  console.log("[fix-contentstate-remove-title-workflow] No `title:`/`workflowId:` fields found. No changes made.");
  process.exit(0);
}

fs.writeFileSync(filePath, s, "utf8");
console.log("[fix-contentstate-remove-title-workflow] Removed unsupported fields in:", filePath);
