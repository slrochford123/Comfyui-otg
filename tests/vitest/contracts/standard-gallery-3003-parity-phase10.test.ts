// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("app/app/AppPageClient.tsx");
const workspace = read("app/app/components/GalleryWorkspace.tsx");
const galleryRoute = read("app/api/gallery/route.ts");
const galleryFileRoute = read("app/api/gallery/file/route.ts");
const gallerySyncRoute = read("app/api/gallery/sync/route.ts");
const galleryLibrary = read("lib/gallery.ts");
const gallerySync = read("lib/comfyGallerySync.ts");
const ownerKey = read("lib/ownerKey.ts");
const paths = read("lib/paths.ts");
const characterHub = read("app/app/components/CharacterHubPanel.tsx");
const characterCreateRoute = read("app/api/characters/create-image/route.ts");

function expectInOrder(source: string, values: string[]) {
  let cursor = -1;
  for (const value of values) {
    const next = source.indexOf(value, cursor + 1);
    expect(next, `Expected ${JSON.stringify(value)} after offset ${cursor}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe("Standard Gallery parity on TEST port 3003 Phase 10", () => {
  it("mounts the stable Standard Gallery workspace from the main app shell", () => {
    expect(app).toContain(
      'const GalleryWorkspace = dynamic(() => import("./components/GalleryWorkspace"), { loading: PanelLoading });',
    );
    expect(app).toContain("<GalleryWorkspace");
    expect(app).toContain("activeTab={tab}");
    expect(workspace).toContain('activeTab === "gallery"');
  });

  it("uses the stable Gallery list and ComfyUI synchronization contracts", () => {
    expect(app).toContain('fetch(`/api/gallery?${params.toString()}`');
    expect(app).toContain('fetch("/api/gallery/sync"');
    expect(app).toContain("forcePull: true");
    expect(gallerySyncRoute).toContain("syncPromptOutputsForOwner({");
    expect(gallerySyncRoute).toContain("forcePullOwnerPrompts({");
    expect(gallerySyncRoute).toContain("syncRecentOwnerPrompts({");
    expect(gallerySync).toContain("export async function syncPromptOutputsForOwner");
    expect(gallerySync).toContain("warmGalleryThumb(absPath, 768)");
    expect(gallerySync).toContain("warmGalleryThumb(absPath, 512)");
  });

  it("returns canonical scoped Gallery URLs and serves them through the scoped resolver", () => {
    expect(galleryLibrary).toContain(
      "`/api/gallery/file?name=${encodeURIComponent(entry)}&scope=${source.scope}`",
    );
    expect(galleryFileRoute).toContain(
      "resolveGalleryItemByName({ sources, name: wantedName, scopeHint })",
    );
    expect(app).toContain(
      "`/api/gallery/file?${params.toString()}`",
    );
    expect(app).toContain('scope: String(item.source || "user")');
  });

  it("preserves authenticated user and device ownership across list, file, and sync", () => {
    expect(ownerKey).toContain("const ownerKey = resolveOwnerAlias(username || deviceId)");
    expect(galleryLibrary).toContain("const owner = await getOwnerContext(req)");
    expect(galleryLibrary).toContain("dir: userGalleryDir(owner.username)");
    expect(galleryLibrary).toContain("dir: deviceGalleryDir(owner.deviceId)");
    expect(galleryRoute).toContain("const { owner, sources } = await getGallerySourcesForRequest(req)");
    expect(galleryFileRoute).toContain("const { sources } = await getGallerySourcesForRequest(req)");
    expect(gallerySyncRoute).toContain("ownerKey: owner.ownerKey");
    expect(gallerySyncRoute).toContain("username: owner.username");
    expect(gallerySyncRoute).toContain("deviceId: owner.deviceId");
    expect(paths).toContain("process.env.OTG_DATA_DIR || process.env.OTG_DATA_ROOT");
  });

  it("keeps the exact stable Gallery-level control labels and order", () => {
    const galleryStart = workspace.indexOf('{activeTab === "gallery" ?');
    const galleryPanel = workspace.slice(
      galleryStart,
      workspace.indexOf('{activeTab === "favorites" ?', galleryStart),
    );

    expectInOrder(galleryPanel, [
      '"Refreshing..." : "Refresh"',
      '"Updating Content..." : "Update Content"',
      'placeholder="Search by name"',
      '<option value="all">All</option>',
      '<option value="images">Images</option>',
      '<option value="videos">Videos</option>',
      '<option value="newest">Newest first</option>',
      '<option value="oldest">Oldest first</option>',
      '<option value="name">Name</option>',
      '<option value="default">Default cards</option>',
      '<option value="grid">Grid view</option>',
      '<option value="list">List view</option>',
      "<PaginationBar",
      "<MediaGrid",
    ]);
    expect(workspace).toContain('option === 0 ? "Unlimited" : option');
    expectInOrder(workspace, [
      "onPageChange(page - 1)",
      "Prev",
      "onPageChange(page + 1)",
      "Next",
    ]);
  });

  it("keeps the exact stable per-item action labels and order", () => {
    const cardActions = workspace.slice(
      workspace.indexOf("const actionButtons = ("),
      workspace.indexOf('if (viewMode === "list")'),
    );

    expectInOrder(cardActions, [
      "Download",
      "{favoriteLabel}",
      "Edit",
      "{animateLabel}",
      "{characterLabel}",
      "Extend",
      "{renameLabel}",
      "{redoLabel}",
      "{deleteLabel}",
    ]);
    expect(workspace).toContain('favorite ? "Saved" : "Heart"');
    expect(workspace).toContain('busyKind === "favorite"');
    expect(workspace).toContain('busyKind === "rename"');
    expect(workspace).toContain('busyKind === "redo"');
    expect(workspace).toContain('busyKind === "delete"');
  });

  it("preserves confirmations, API calls, disabled states, and error handling", () => {
    expect(app).toContain(
      'window.confirm(`Delete "${item.name || name}"? This removes the gallery file and metadata.`)',
    );
    expect(app).toContain('fetch("/api/gallery/favorite"');
    expect(app).toContain('fetch("/api/gallery/rename"');
    expect(app).toContain('fetch("/api/gallery/delete"');
    expect(workspace).toContain("disabled={galleryBusy || galleryForcePullBusy || galleryActionsLocked}");
    expect(workspace).toContain("disabled={isBusy}");
    expect(app).toContain('data?.error || "Update Content failed."');
  });

  it("preserves thumbnails, missing-image fallback, and mobile-safe media sizing", () => {
    expect(workspace).toContain("function buildGalleryThumbUrl");
    expect(workspace).toContain("`/api/thumb?${params.toString()}`");
    expect(workspace).toContain("setFailedThumbUrl(thumbUrl)");
    expect(workspace).toContain('loading={eager ? "eager" : "lazy"}');
    expect(workspace).toContain('className="h-full w-full object-contain"');
    expect(workspace).toContain('className="max-h-[78vh] w-full object-contain"');
    expect(workspace).toContain("playsInline");
  });

  it("preserves expanded viewer navigation, swipe, and keyboard behavior", () => {
    expectInOrder(workspace, [
      "onMoveViewer(\"prev\")",
      "Prev",
      "onMoveViewer(\"next\")",
      "Next",
      "onCloseViewer",
      "Close",
    ]);
    expect(workspace).toContain('aria-label="Previous item"');
    expect(workspace).toContain('aria-label="Next item"');
    expect(workspace).toContain("onTouchStart={onViewerTouchStart}");
    expect(workspace).toContain("onTouchEnd={onViewerTouchEnd}");
    expect(workspace).toContain("Swipe left or right, or use the arrow keys");
    expect(app).toContain('event.key === "ArrowLeft"');
    expect(app).toContain('event.key === "ArrowRight"');
  });

  it("keeps refresh/sync separate and preserves newest-first defaults", () => {
    expect(app).toContain(
      'const [gallerySort, setGallerySort] = useState<"newest" | "oldest" | "name">("newest")',
    );
    expect(app).toContain("onRefreshGallery={() => void loadGallery()}");
    expect(app).toContain("onForcePullGallery={() => void handleGalleryForcePull()}");
    expect(galleryLibrary).toContain(
      "items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))",
    );
  });

  it("keeps Character candidates and Saved for Later outside Standard Gallery", () => {
    expect(characterCreateRoute).toContain("temporaryCandidate: true");
    expect(characterCreateRoute).toContain('class_type: "PreviewImage"');
    expect(characterCreateRoute).not.toContain('class_type: "SaveImage"');
    expect(characterHub).toContain('"/api/characters/saved-for-later"');
    expect(characterHub).not.toContain('fetch("/api/gallery"');
    expect(gallerySync).toContain("shouldSuppressGeneralGalleryImport");
    expect(gallerySync).toContain('context.includes("character-candidate")');
  });

  it("retains CharacterHubPanel, Mage Flow, and Legacy Characters routing", () => {
    expect(app).toContain(
      'const CharactersPanel = dynamic(() => import("./components/CharacterHubPanel"), { loading: PanelLoading });',
    );
    expect(app).toContain(
      '{tab === "characters" ? <CharactersPanel isAdmin={isAdmin} /> : null}',
    );
    expect(characterHub).toContain('import LegacyCharactersPanel from "./CharactersPanel"');
    expect(characterCreateRoute).toContain('"mage-flow"');
  });

  it("introduces no PROD path or port-3001 service configuration", () => {
    const paritySources = [
      app,
      workspace,
      galleryRoute,
      galleryFileRoute,
      gallerySyncRoute,
      galleryLibrary,
      gallerySync,
      ownerKey,
      paths,
    ].join("\n");

    expect(paritySources).not.toContain("/home/shawn-rochford/AI/deploy/otg-prod");
    expect(paritySources).not.toContain("PORT=3001");
    expect(paritySources).not.toContain(":3001");
  });
});
