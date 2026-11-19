const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(repoRoot, request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const before = source.includes("import.meta") ? [context => {
    const visit = node => ts.isPropertyAccessExpression(node) && node.name.text === "url"
      && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
      ? context.factory.createStringLiteral(pathToFileURL(filename).href)
      : ts.visitEachChild(node, visit, context);
    return file => ts.visitNode(file, visit);
  }] : [];
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
    transformers: { before },
  });
  module._compile(output.outputText, filename);
};
