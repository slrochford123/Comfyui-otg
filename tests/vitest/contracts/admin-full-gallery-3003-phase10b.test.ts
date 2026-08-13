// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listAdminGallery, resolveLocalAdminGalleryFile } from "@/lib/adminGallerySources";

const root = process.cwd();
const read = (name: string) => fs.readFileSync(path.join(root, name), "utf8");
const app = read("app/app/AppPageClient.tsx");
const quickPanel = read("app/app/components/AdminQuickPanel.tsx");
const adminPage = read("app/app/admin/page.tsx");
const adminLayout = read("app/app/admin/layout.tsx");
const page = read("app/app/admin/gallery/page.tsx");
const panel = read("app/app/components/AdminGallerySourcesPanel.tsx");
const listRoute = read("app/api/admin/gallery-sources/route.ts");
const fileRoute = read("app/api/admin/gallery-file/route.ts");
const library = read("lib/adminGallerySources.ts");
const standard = read("app/app/components/GalleryWorkspace.tsx");
const agent = read("scripts/linux/admin-gallery-agent/otg_admin_gallery_agent.py");
const service = read("scripts/linux/admin-gallery-agent/otg-admin-gallery-agent.service");
const envExample = read(".env.example");
const temporaryRoots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const temporaryRoot of temporaryRoots.splice(0)) fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

function inOrder(source: string, values: string[]) {
  let cursor = -1;
  for (const value of values) {
    cursor = source.indexOf(value, cursor + 1);
    expect(cursor, `missing or out of order: ${value}`).toBeGreaterThan(-1);
  }
}

describe("Admin Full Gallery on TEST 3003 Phase 10b", () => {
  it("exposes Settings -> Admin -> Full Gallery at the existing admin route", () => {
    expect(app).toContain("<AdminQuickPanel />");
    expect(quickPanel).toContain('href="/app/admin/gallery"');
    expect(quickPanel).toContain("Full Gallery");
    expect(adminPage).toContain("Full Gallery");
    expect(page).toContain("<AdminGallerySourcesPanel />");
  });

  it("protects the page and both APIs with server-side admin authorization", () => {
    expect(adminLayout).toContain("await requireAdmin()");
    expect(adminLayout).toContain('redirect("/app?reason=forbidden")');
    expect(listRoute).toContain("const admin = await requireAdmin()");
    expect(fileRoute.match(/const admin = await requireAdmin\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(listRoute).toContain("status: admin.status");
    expect(fileRoute).toContain("status: admin.status");
  });

  it("offers exactly the requested source filters and badges every item", () => {
    inOrder(panel, ["All Sources", "RTX 3090 ComfyUI", "RTX 5060 Ti ComfyUI"]);
    expect(panel).toContain("<SourceBadge label={item.sourceLabel} />");
    expect(library).toContain('sourceLabel: source.label');
  });

  it("uses the verified/configurable local RTX 3090 output root", () => {
    expect(library).toContain('const LOCAL_3090_OUTPUT_ROOT = "/home/shawn-rochford/AI/ComfyUI/ComfyUI/output"');
    expect(library).toContain("process.env.OTG_ADMIN_GALLERY_3090_ROOT");
    expect(envExample).toContain("OTG_ADMIN_GALLERY_3090_ROOT=/home/shawn-rochford/AI/ComfyUI/ComfyUI/output");
  });

  it("uses authenticated server-side transport for the RTX 5060 Ti", () => {
    expect(library).toContain("process.env.OTG_ADMIN_GALLERY_5060_URL");
    expect(library).toContain("process.env.OTG_ADMIN_GALLERY_5060_TOKEN");
    expect(library).toContain("Authorization: `Bearer ${token}`");
    expect(agent).toContain("hmac.compare_digest");
    expect(service).toContain("EnvironmentFile=/etc/otg/admin-gallery-agent.env");
  });

  it("never returns filesystem roots or the remote token to the browser", () => {
    expect(listRoute).not.toContain("process.env");
    expect(panel).not.toContain("OTG_ADMIN_GALLERY_5060_TOKEN");
    expect(agent).not.toContain('"root": str(ROOT)');
    expect(library).not.toContain("NEXT_PUBLIC_");
  });

  it("recursively lists only supported images and videos", () => {
    expect(library).toContain("await walkLocal(root, candidate, source, items)");
    for (const extension of [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mkv"]) {
      expect(library).toContain(`"${extension}"`);
      expect(agent).toContain(`"${extension}"`);
    }
    for (const extension of [".json", ".txt", ".latent", ".db"]) expect(library).not.toContain(`"${extension}"`);
  });

  it("behaviorally lists recursive local media newest-first while excluding unsupported files", async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-admin-gallery-test-"));
    temporaryRoots.push(temporaryRoot);
    fs.mkdirSync(path.join(temporaryRoot, "nested"));
    fs.writeFileSync(path.join(temporaryRoot, "older.png"), "png");
    fs.writeFileSync(path.join(temporaryRoot, "nested", "newer.mp4"), "mp4");
    fs.writeFileSync(path.join(temporaryRoot, "nested", "workflow.json"), "{}");
    fs.utimesSync(path.join(temporaryRoot, "older.png"), new Date(1_000), new Date(1_000));
    fs.utimesSync(path.join(temporaryRoot, "nested", "newer.mp4"), new Date(2_000), new Date(2_000));
    vi.stubEnv("OTG_ADMIN_GALLERY_3090_ROOT", temporaryRoot);

    const result = await listAdminGallery({ source: "comfy-3090", limit: 20 });
    expect(result.ok).toBe(true);
    expect(result.items.map((item) => item.rel)).toEqual(["nested/newer.mp4", "older.png"]);
    expect(result.items.map((item) => item.kind)).toEqual(["video", "image"]);
  });

  it("sorts newest first with deterministic source/path tie breakers", () => {
    expect(library).toContain("b.mtimeMs - a.mtimeMs || a.source.localeCompare(b.source) || a.rel.localeCompare(b.rel)");
    expect(agent).toContain('records.sort(key=lambda item: (-item["mtimeMs"], item["rel"]))');
  });

  it("isolates source failures and bounds incremental responses", () => {
    expect(library).toContain("Promise.all(selected.map((source) => listOneSource(source, fetchLimit)))");
    expect(library).toContain("ok: results.some((result) => result.ok)");
    expect(library).toContain("Math.min(100, Math.max(1");
    expect(panel).toContain("Load More");
  });

  it("preserves canonical relative subfolder paths and rejects traversal/symlink escapes", () => {
    expect(library).toContain('part === ".."');
    expect(library).toContain("await fs.realpath(candidate)");
    expect(library).toContain("assertWithinRoot(root, realCandidate)");
    expect(library).toContain('if (entry.isSymbolicLink()) continue');
    expect(agent).toContain("candidate.relative_to(ROOT)");
    expect(agent).toContain('part in {".", ".."}');
  });

  it("behaviorally rejects traversal and symlink escape paths", async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-admin-gallery-root-"));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-admin-gallery-outside-"));
    temporaryRoots.push(temporaryRoot, outsideRoot);
    fs.writeFileSync(path.join(outsideRoot, "outside.png"), "png");
    fs.symlinkSync(path.join(outsideRoot, "outside.png"), path.join(temporaryRoot, "escape.png"));
    vi.stubEnv("OTG_ADMIN_GALLERY_3090_ROOT", temporaryRoot);

    await expect(resolveLocalAdminGalleryFile("comfy-3090", "../outside.png")).rejects.toThrow();
    await expect(resolveLocalAdminGalleryFile("comfy-3090", "escape.png")).rejects.toThrow("escapes its configured root");
  });

  it("serves correct MIME types and byte ranges without buffering whole videos", () => {
    expect(fileRoute).toContain('request.headers.get("range")');
    expect(fileRoute).toContain('status: range ? 206 : 200');
    expect(fileRoute).toContain('headers.set("Content-Range"');
    expect(fileRoute).toContain("fs.createReadStream(resolved.path, { start, end })");
    expect(fileRoute).toContain("upstream.body");
    expect(agent).toContain('self.send_header("Accept-Ranges", "bytes")');
    expect(agent).toContain("handle.read(min(1024 * 1024, remaining))");
    expect(library).toContain('if (ext === ".mov") return "video/quicktime"');
  });

  it("matches Standard Gallery-level controls and per-item label ordering", () => {
    inOrder(panel, ["Refreshing...", "Refresh", "Update Content", 'placeholder="Search by name"', '>All<', '>Images<', '>Videos<', '>Newest first<', '>Oldest first<', '>Name<', '>Default cards<', '>Grid view<', '>List view<']);
    inOrder(panel, [">Download<", "<IconHeart />Heart", ">Edit<", ">Animate<", ">Characters<", ">Extend<", ">Rename<", ">Redo<", '"Deleting..." : "Delete"']);
    inOrder(standard, ["Download", "<IconHeart", "Edit", "Animate", "Characters", "Extend", "Rename", "Redo", "Delete"]);
    expect(panel).toContain("This Standard Gallery action is disabled because Full Gallery items are filesystem-backed");
  });

  it("uses the same mixed image/video viewer navigation and mobile-safe Close contract", () => {
    expect(panel).toContain("createPortal(");
    expect(panel).toContain('item.kind === "video" ? <video');
    expect(panel).toContain("controls autoPlay playsInline preload=\"metadata\"");
    inOrder(panel, [">Prev<", ">Next<", ">Close<"]);
    expect(panel).toContain("onTouchStart");
    expect(panel).toContain("onTouchEnd");
    expect(panel).toContain("max-h-[100dvh]");
  });

  it("implements source-specific admin-only deletion with confirmation and refresh", () => {
    expect(panel).toContain('window.confirm(`Delete "${item.name}"? This permanently removes the source file.`)');
    expect(panel).toContain('method: "DELETE"');
    expect(panel).toContain("await load(false)");
    expect(fileRoute).toContain("await deleteAdminGalleryFile(sourceId, rel)");
    expect(agent).toContain("file_path.unlink()");
  });

  it("keeps Character candidates and normal Gallery persistence outside this contract", () => {
    expect(library).not.toContain("CharacterHubPanel");
    expect(library).not.toContain("saved-for-later");
    expect(library).not.toContain("character-candidate");
    expect(library).not.toContain("device_galleries");
    expect(library).not.toContain("user_galleries");
    expect(panel).toContain("never copied into the normal Gallery");
  });

  it("contains no PROD or stable port-3001 configuration", () => {
    const scoped = [library, listRoute, fileRoute, panel, agent, service, quickPanel, page].join("\n");
    expect(scoped).not.toMatch(/\bPROD\b/);
    expect(scoped).not.toContain(":3001");
    expect(scoped).not.toContain("OTG-Test2");
    expect(scoped).not.toContain("8288");
  });
});
