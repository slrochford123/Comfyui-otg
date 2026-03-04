const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function mustExist(p) {
  if (!fs.existsSync(p)) throw new Error("Missing expected file: " + p);
}
function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, "utf8");
}
function replaceOrThrow(file, from, to) {
  const s = read(file);
  if (!s.includes(from)) throw new Error(`Anchor not found in ${file}: ${from.slice(0,80)}...`);
  write(file, s.replace(from, to));
}
function insertAfterOrThrow(file, anchor, insertion) {
  const s = read(file);
  const idx = s.indexOf(anchor);
  if (idx === -1) throw new Error(`Anchor not found in ${file}: ${anchor.slice(0,80)}...`);
  const out = s.slice(0, idx + anchor.length) + insertion + s.slice(idx + anchor.length);
  write(file, out);
}

//
// 1) SupportPanel: add image input + submit multipart when image exists
//
const supportPanel = path.join(ROOT, "app", "app", "components", "SupportPanel.tsx");
mustExist(supportPanel);

let sp = read(supportPanel);

// Add state for attachment
if (!sp.includes("const [fbImage, setFbImage]")) {
  const stateAnchor = 'const [fbMessage, setFbMessage] = useState<string>("");';
  if (!sp.includes(stateAnchor)) throw new Error("SupportPanel state anchor not found");
  sp = sp.replace(
    stateAnchor,
    stateAnchor +
      '\n  const [fbImage, setFbImage] = useState<File | null>(null);\n' +
      '  const [fbImageUrl, setFbImageUrl] = useState<string>("");\n'
  );
}

// Update submitFeedback to use FormData if fbImage
if (sp.includes('headers: { "Content-Type": "application/json" }')) {
  sp = sp.replace(
    `      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: fbCategory,
          message: fbMessage,
          page: "/app (Support)",
        }),
      });`,
    `      let res;
      if (fbImage) {
        const fd = new FormData();
        fd.set("category", fbCategory);
        fd.set("message", fbMessage);
        fd.set("page", "/app (Support)");
        fd.set("attachment", fbImage);
        res = await fetch("/api/feedback", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: fbCategory,
            message: fbMessage,
            page: "/app (Support)",
          }),
        });
      }`
  );
}

// After successful submit, clear attachment state too
if (!sp.includes("setFbImage(null)")) {
  sp = sp.replace(
    '      setFbMessage("");',
    '      setFbMessage("");\n      setFbImage(null);\n      setFbImageUrl("");'
  );
}

// Inject UI for file input inside feedback tab
// Find feedback textarea block by looking for fbMessage textarea
if (!sp.includes('accept="image/*"')) {
  const uiAnchor = `          <textarea
            value={fbMessage}
            onChange={(e) => setFbMessage(e.target.value)}`;
  if (!sp.includes(uiAnchor)) throw new Error("SupportPanel feedback textarea anchor not found");

  const injection =
`          <div className="otg-row" style={{ marginTop: 10, gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label className="otg-btnGhost" style={{ cursor: "pointer" }}>
              Add Screenshot
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                  setFbImage(f);
                  if (fbImageUrl) URL.revokeObjectURL(fbImageUrl);
                  setFbImageUrl(f ? URL.createObjectURL(f) : "");
                }}
              />
            </label>

            {fbImage ? (
              <button
                type="button"
                className="otg-btnGhost"
                onClick={() => {
                  if (fbImageUrl) URL.revokeObjectURL(fbImageUrl);
                  setFbImage(null);
                  setFbImageUrl("");
                }}
              >
                Remove Screenshot
              </button>
            ) : null}
          </div>

          {fbImageUrl ? (
            <div style={{ marginTop: 10 }}>
              <img
                src={fbImageUrl}
                alt="Feedback attachment preview"
                style={{ maxWidth: "100%", borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)" }}
              />
            </div>
          ) : null}

`;

  sp = sp.replace(uiAnchor, injection + uiAnchor);
}

write(supportPanel, sp);


//
// 2) /api/feedback: accept JSON or multipart + store attachment
//
const feedbackRoute = path.join(ROOT, "app", "api", "feedback", "route.ts");
mustExist(feedbackRoute);
let fr = read(feedbackRoute);

if (!fr.includes("await req.formData()")) {
  // Replace the JSON-only read with content-type branching
  const anchor = "export async function POST(req: Request) {";
  if (!fr.includes(anchor)) throw new Error("feedback route anchor not found");

  // Rewrite whole POST body in a controlled way
  const newPost =
`export async function POST(req: Request) {
  try {
    const ct = (req.headers.get("content-type") || "").toLowerCase();

    let category = "";
    let message = "";
    let email = "";
    let page = "";
    let attachmentPath: string | undefined;

    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      category = typeof fd.get("category") === "string" ? String(fd.get("category")).trim() : "";
      message = typeof fd.get("message") === "string" ? String(fd.get("message")).trim() : "";
      email = sanitizeEmail(fd.get("email"));
      page = typeof fd.get("page") === "string" ? String(fd.get("page")).trim() : "";

      const file = fd.get("attachment");
      if (file && typeof file === "object" && "arrayBuffer" in file) {
        const now = new Date();
        const id = now.getTime().toString(36) + "-" + Math.random().toString(16).slice(2, 10);
        const type = (file.type || "").toLowerCase();
        const ext =
          type.includes("png") ? ".png" :
          type.includes("jpeg") ? ".jpg" :
          type.includes("jpg") ? ".jpg" :
          type.includes("webp") ? ".webp" :
          ".png";

        const dataRoot = getDataRoot();
        const adir = path.join(dataRoot, "feedback_attachments");
        await fs.mkdir(adir, { recursive: true });

        const outPath = path.join(adir, \`\${id}\${ext}\`);
        const buf = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(outPath, buf);
        attachmentPath = \`feedback_attachments/\${id}\${ext}\`;
      }
    } else {
      const raw = await req.text();
      let body: any;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return NextResponse.json({ error: "Request must be JSON or multipart/form-data" }, { status: 415 });
      }

      category = typeof body?.category === "string" ? body.category.trim() : "";
      message = typeof body?.message === "string" ? body.message.trim() : "";
      email = sanitizeEmail(body?.email);
      page = typeof body?.page === "string" ? body.page.trim() : "";
    }

    if (!message) return NextResponse.json({ error: "Missing message" }, { status: 400 });
    if (message.length > 8000) return NextResponse.json({ error: "Message too long" }, { status: 413 });

    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, "0");

    const dataRoot = getDataRoot();
    const dir = path.join(dataRoot, "feedback");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, \`feedback-\${y}-\${m}.jsonl\`);

    const deviceId =
      req.headers.get("x-otg-device-id") ||
      req.headers.get("x-otg-device") ||
      req.headers.get("x-device-id") ||
      "";

    const record = {
      createdAt: now.toISOString(),
      category: category || "Question",
      email: email || undefined,
      page: page || undefined,
      deviceId: deviceId || undefined,
      message,
      attachment: attachmentPath || undefined,
    };

    await fs.appendFile(file, JSON.stringify(record) + "\\n", "utf8");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
`;

  // Replace existing POST function by regex range
  fr = fr.replace(/export async function POST\([\s\S]*?\n}\n\s*$/m, newPost + "\n");
  write(feedbackRoute, fr);
}


//
// 3) Admin feedback API: include attachment field
//
const adminFeedbackRoute = path.join(ROOT, "app", "api", "admin", "feedback", "route.ts");
mustExist(adminFeedbackRoute);
let afr = read(adminFeedbackRoute);

if (!afr.includes("attachment?: string")) {
  afr = afr.replace(
    "type FeedbackRecord = {",
    "type FeedbackRecord = {\n  attachment?: string;\n"
  );
}

if (!afr.includes("attachment: typeof j?.attachment")) {
  // Add parse support
  afr = afr.replace(
    "return {\n      createdAt: createdAt || new Date(0).toISOString(),\n      category:",
    "return {\n      createdAt: createdAt || new Date(0).toISOString(),\n      attachment: typeof j?.attachment === \"string\" ? j.attachment : undefined,\n      category:"
  );
}

write(adminFeedbackRoute, afr);


//
// 4) Admin attachment serving route (admin-only)
//
const adminAttachRoute = path.join(ROOT, "app", "api", "admin", "feedback", "attachment", "route.ts");
if (!fs.existsSync(adminAttachRoute)) {
  write(
    adminAttachRoute,
`import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { requireAdmin } from "../../_requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getDataRoot() {
  return (process.env.OTG_DATA_DIR && process.env.OTG_DATA_DIR.trim()) || path.join(process.cwd(), "data");
}

function safeRel(p: string) {
  const v = String(p || "").trim().replace(/\\\\/g, "/");
  if (!v) return "";
  // only allow feedback_attachments/...
  if (!v.startsWith("feedback_attachments/")) return "";
  // prevent traversal
  if (v.includes("..")) return "";
  return v;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const rel = safeRel(url.searchParams.get("path") || "");
  if (!rel) return NextResponse.json({ ok: false, error: "bad_path" }, { status: 400 });

  const full = path.join(getDataRoot(), rel);
  try {
    const buf = await fs.readFile(full);
    const ext = path.extname(full).toLowerCase();
    const ct =
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".webp" ? "image/webp" :
      "image/png";
    return new NextResponse(buf, { status: 200, headers: { "content-type": ct, "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
}
`
  );
}


//
// 5) Admin Feedback 404: create app/app/admin/feedback route (App Router)
//
const appAdminFeedbackDir = path.join(ROOT, "app", "app", "admin", "feedback");
const appAdminFeedbackPage = path.join(appAdminFeedbackDir, "page.tsx");
const appAdminFeedbackClient = path.join(appAdminFeedbackDir, "feedback-client.tsx");

if (!fs.existsSync(appAdminFeedbackPage)) {
  write(
    appAdminFeedbackPage,
`import AdminFeedbackClient from "./feedback-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminFeedbackPage() {
  return (
    <main className="otg-authPage">
      <div className="otg-authBg" />
      <section className="otg-authCard2" style={{ maxWidth: 980 }}>
        <h1 className="otg-authTitle" style={{ marginBottom: 6 }}>Admin • Feedback</h1>
        <p className="otg-authSub" style={{ marginBottom: 16 }}>
          Latest user feedback notes. (Admins only)
        </p>
        <AdminFeedbackClient />
      </section>
    </main>
  );
}
`
  );
}

if (!fs.existsSync(appAdminFeedbackClient)) {
  write(
    appAdminFeedbackClient,
`"use client";

import { useEffect, useMemo, useState } from "react";

type FeedbackItem = {
  createdAt: string;
  category?: string;
  page?: string;
  message: string;
  attachment?: string;
};

type ApiResponse =
  | { ok: true; count: number; items: FeedbackItem[] }
  | { ok: false; error: string };

export default function AdminFeedbackClient() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/feedback", { credentials: "include", cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as ApiResponse;
      if (!r.ok || !j || (j as any).ok !== true) {
        setErr((j as any)?.error || "Not authorized");
        setItems([]);
        return;
      }
      setItems((j as any).items || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load feedback");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((it) => {
      const t = \`\${it.category || ""} \${it.page || ""} \${it.message || ""}\`.toLowerCase();
      return t.includes(s);
    });
  }, [items, q]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="otg-row" style={{ gap: 10 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search feedback…"
          className="otg-input"
          style={{ maxWidth: 420 }}
        />
        <button type="button" className="otg-btnGhost" onClick={load}>Refresh</button>
      </div>

      {loading ? <div className="otg-help">Loading…</div> : null}
      {err ? <div className="otg-error">{err}</div> : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((it, idx) => (
          <div key={idx} className="otg-card" style={{ padding: 12 }}>
            <div className="otg-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div className="otg-help" style={{ marginTop: 0 }}>
                <b>{it.category || "Feedback"}</b>
                {it.page ? <span style={{ opacity: 0.7 }}> • {it.page}</span> : null}
              </div>
              <div className="otg-help" style={{ marginTop: 0, opacity: 0.7 }}>
                {new Date(it.createdAt).toLocaleString()}
              </div>
            </div>

            <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{it.message}</div>

            {it.attachment ? (
              <div style={{ marginTop: 10 }}>
                <img
                  src={\`/api/admin/feedback/attachment?path=\${encodeURIComponent(it.attachment)}\`}
                  alt="attachment"
                  style={{ maxWidth: "100%", borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)" }}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
`
  );
}


//
// 6) Ollama tab: enable Start Mic (remove olamaBusy from disabled condition)
//
const getHelpPanel = path.join(ROOT, "app", "app", "components", "GetHelpPanel.tsx");
mustExist(getHelpPanel);
let gh = read(getHelpPanel);

// Replace: disabled={!recordingSupported || olamaBusy}  -> disabled={!recordingSupported}
gh = gh.replace(
  /disabled=\{\!recordingSupported\s*\|\|\s*olamaBusy\}/g,
  'disabled={!recordingSupported}'
);

write(getHelpPanel, gh);


//
// 7) Gallery: circular retry icon + add download + favorite buttons + redo/meta fallback
//
const appPage = path.join(ROOT, "app", "app", "page.tsx");
mustExist(appPage);
let pg = read(appPage);

// Change straight arrow to circular arrow in gallery retry button
pg = pg.replace('<span>{"→"}</span>', '<span>{"⟳"}</span>');

// Add helper functions for per-item download + favorite if missing
if (!pg.includes("const onFavoriteName")) {
  const anchor = "const deleteFromGallery = useCallback(async (name: string) => {";
  if (!pg.includes(anchor)) throw new Error("page.tsx anchor not found for deleteFromGallery");

  const insert =
`\n\n  const onDownloadName = useCallback((name: string) => {
    try {
      const a = document.createElement("a");
      a.href = \`/api/gallery/file?name=\${encodeURIComponent(name)}&download=1\`;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }, []);

  const onFavoriteName = useCallback(async (name: string) => {
    setErr(null);
    try {
      setBusy(true);
      const r = await fetch(\`/api/favorites/add?name=\${encodeURIComponent(name)}\`, { method: "POST" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || \`Send to Favorites failed (\${r.status})\`);
      showToast("Saved to Favorites");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [showToast]);
`;

  pg = pg.replace(anchor, insert + "\n\n" + anchor);
}

// Inject buttons into gallery row (Download + Favorite)
// Find the retry button block and add two buttons after it if not already present
if (!pg.includes('title="Download"') || !pg.includes('title="Favorite"')) {
  const retryBtnAnchor =
`                        <button
                          type="button"
                          className="otg-btnGhost"
                          title="Retry / Regenerate"
                          onClick={() => retryFromGallery(f.name)}
                          disabled={uiLocked}
                          style={{ width: 40, height: 40, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <span>{"⟳"}</span>
                        </button>`;

  if (pg.includes(retryBtnAnchor)) {
    const addBtns =
retryBtnAnchor +
`
                        <button
                          type="button"
                          className="otg-btnGhost"
                          title="Download"
                          onClick={() => onDownloadName(f.name)}
                          disabled={uiLocked}
                          style={{ width: 40, height: 40, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <span>{"⬇"}</span>
                        </button>

                        <button
                          type="button"
                          className="otg-btnGhost"
                          title="Favorite"
                          onClick={() => onFavoriteName(f.name)}
                          disabled={uiLocked}
                          style={{ width: 40, height: 40, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <span>{"❤"}</span>
                        </button>
`;
    pg = pg.replace(retryBtnAnchor, addBtns);
  } else {
    // If anchor doesn't match exactly (formatting differs), don't silently fail
    throw new Error("Could not find gallery retry button block to inject Download/Favorite buttons.");
  }
}

write(appPage, pg);


//
// 8) /api/gallery/meta fallback: no 404 + synthesize submitPayload
//
const galleryMetaRoute = path.join(ROOT, "app", "api", "gallery", "meta", "route.ts");
mustExist(galleryMetaRoute);
let mr = read(galleryMetaRoute);

if (mr.includes('return NextResponse.json({ ok: false, error: "no_meta" }, { status: 404 });')) {
  mr = mr.replace(
    'return NextResponse.json({ ok: false, error: "no_meta" }, { status: 404 });',
    `// If meta is missing, return a default object so UI can still show prompts (as empty) without hard-failing.
      return NextResponse.json({
        ok: true,
        meta: {
          ts: Date.now(),
          prompt_id: null,
          preset: null,
          title: null,
          positivePrompt: null,
          negativePrompt: null,
          prompts: null,
          loras: null,
          seed: null,
          submitPayload: null,
          legacy: true,
        }
      });`
  );
}

// After parsing meta, ensure submitPayload exists when possible
if (!mr.includes("if (!meta.submitPayload)")) {
  mr = mr.replace(
    "const meta = JSON.parse(raw);\n    return NextResponse.json({ ok: true, meta });",
    `const meta = JSON.parse(raw);

    // Synthesize a minimal retry payload if missing but we have prompt fields.
    if (!meta.submitPayload) {
      meta.submitPayload = {
        preset: meta.preset ?? null,
        prompts: Array.isArray(meta.prompts) ? meta.prompts : (meta.prompts ?? null),
        positivePrompt: meta.positivePrompt ?? null,
        negativePrompt: meta.negativePrompt ?? null,
        loras: meta.loras ?? null,
        seed: meta.seed ?? null,
        title: meta.title ?? "",
        width: null,
        height: null,
        durationSeconds: null,
        frameCount: null,
      };
    }

    return NextResponse.json({ ok: true, meta });`
  );
}

write(galleryMetaRoute, mr);

console.log("OK: Applied Support screenshot upload + admin feedback route + attachment storage/serving + mic enable + gallery buttons + meta fallback.");
