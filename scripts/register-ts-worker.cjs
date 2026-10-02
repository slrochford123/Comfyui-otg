const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const resolved = path.join(repoRoot, request.slice(2));
    if (!path.extname(resolved)) {
      for (const extension of [".ts", ".tsx", ".js", ".jsx"]) {
        if (fs.existsSync(`${resolved}${extension}`)) return `${resolved}${extension}`;
      }
      if (fs.existsSync(path.join(resolved, "index.ts"))) return path.join(resolved, "index.ts");
      if (fs.existsSync(path.join(resolved, "index.tsx"))) return path.join(resolved, "index.tsx");
    }
    return originalResolveFilename.call(this, resolved, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      skipLibCheck: true,
      strict: false,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};
