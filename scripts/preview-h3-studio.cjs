/* No server, authentication, model, paid API or GPU is used. Real React component + mocked catalog. */
require("./register-ts-worker.cjs");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw Error("Pass an absolute output directory for mock UI evidence.");
fs.mkdirSync(output, { recursive: true });
require.extensions[".tsx"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
require.extensions[".css"] = module => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) }; };
const dom = new JSDOM("<div id='root'></div>", { url: "http://mock.invalid" });
global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.fetch = async () => new Response(JSON.stringify({ ok: true, catalog: require("../lib/h3Stage1cProvenance.json").entries.map(e => ({ id: `civitai-${e.modelId}-${e.versionId}`, name: `Selected H3 model ${e.versionId}`, version: "Mock preview", category: "Mock catalog", categories: ["Mock catalog"], installation: "unverified", rights: "unresolved", blockedReasons: ["QUALIFICATION_REQUIRED"] })) }));
const React = require("react");
const { createRoot } = require("react-dom/client");
const Component = require("../app/app/components/H3StudioControls").default;
const { generateThemeFromColor, themeTokensToCssVars } = require("../lib/appTheme");
const css = fs.readFileSync(path.join(__dirname, "../app/app/components/H3StudioControls.module.css"), "utf8");
async function main() {
  const root = createRoot(document.getElementById("root"));
  await React.act(async () => { root.render(React.createElement(Component, { ownerKey: "mock-preview-only" })); });
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const results = [];
  for (const mode of ["auto", "manual"]) {
    if (mode === "manual") await React.act(async () => [...document.querySelectorAll("button")].find(b => b.textContent === "Manual Mode").click());
    if (mode === "manual") document.querySelectorAll("details").forEach(d => d.open = true);
    for (const theme of ["light", "dark"]) {
      const vars = Object.entries(themeTokensToCssVars(generateThemeFromColor("#f97316", theme))).map(([k, v]) => `${k}:${v}`).join(";");
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll("select").forEach((select, index) => [...select.options].forEach(option => { if (option.value === document.querySelectorAll("select")[index].value) option.setAttribute("selected", ""); else option.removeAttribute("selected"); }));
      const html = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mock H3 ${mode} – not device acceptance</title><style>:root{${vars}}*{box-sizing:border-box}body{margin:0;padding:8px;background:var(--color-background);font:14px system-ui} ${css}</style>${clone.innerHTML}`;
      fs.writeFileSync(path.join(output, `${mode}-${theme}.html`), html);
      for (const width of [360, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        await page.setContent(html);
        const geometry = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, smallTargets: [...document.querySelectorAll("button,input:not([type=checkbox]),label:has(input[type=checkbox]),select,summary")].filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.height < 44; }).map(element => element.textContent || element.type) }));
        await page.screenshot({ path: path.join(output, `${mode}-${theme}-${width}x844.png`), fullPage: true });
        results.push({ mode, theme, ...geometry, evidence: "mock desktop Chromium viewport, not Android physical acceptance" });
      }
    }
  }
  await browser.close(); await React.act(async () => root.unmount());
  fs.writeFileSync(path.join(output, "geometry.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  if (results.some(r => r.horizontalOverflow)) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
