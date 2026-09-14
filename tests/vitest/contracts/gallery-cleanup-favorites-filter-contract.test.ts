import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(
    path.join(ROOT, relativePath),
    "utf8",
  );
}

function exists(relativePath: string) {
  return fs.existsSync(
    path.join(ROOT, relativePath),
  );
}

describe("Gallery cleanup Favorites filter contract", () => {
  it("does not resurrect the removed Favorites workspace", () => {
    const nav = read(
      "app/app/components/SpinDialNav.tsx",
    );

    const workspace = read(
      "app/app/components/GalleryWorkspace.tsx",
    );

    const app = read(
      "app/app/AppPageClient.tsx",
    );

    expect(nav).not.toContain(
      '{ id: "favorites"'
    );

    expect(workspace).not.toContain(
      'activeTab === "favorites"'
    );

    expect(app).not.toContain(
      'tab === "favorites"'
    );

    expect(
      exists("app/api/favorites/route.ts"),
    ).toBe(false);
  });

  it("preserves Gallery heart metadata and mutation API", () => {
    const app = read(
      "app/app/AppPageClient.tsx",
    );

    const workspace = read(
      "app/app/components/GalleryWorkspace.tsx",
    );

    const gallery = read(
      "lib/gallery.ts",
    );

    expect(
      exists("app/api/gallery/favorite/route.ts"),
    ).toBe(true);

    expect(app).toContain(
      'fetch("/api/gallery/favorite"'
    );

    expect(workspace).toContain(
      "meta?.favorite"
    );

    expect(gallery).toContain(
      "favorite?: boolean"
    );
  });

  it("filters Favorites on the server before pagination", () => {
    const gallery = read(
      "lib/gallery.ts",
    );

    expect(gallery).toContain(
      "favoritesOnly?: boolean;"
    );

    expect(gallery).toContain(
      "if (opts.favoritesOnly)"
    );

    expect(gallery).toContain(
      "Boolean(item.meta?.favorite)"
    );

    const favoritesIndex = gallery.indexOf(
      "if (opts.favoritesOnly)"
    );

    const paginationIndex = gallery.indexOf(
      "const per = "
    );

    expect(favoritesIndex).toBeGreaterThan(-1);
    expect(paginationIndex).toBeGreaterThan(-1);
    expect(favoritesIndex).toBeLessThan(paginationIndex);
  });

  it("accepts the canonical favorite=1 Gallery API filter", () => {
    const route = read(
      "app/api/gallery/route.ts",
    );

    expect(route).toContain(
      'req.nextUrl.searchParams.get("favorite")'
    );

    expect(route).toContain(
      "favoritesOnly"
    );

    expect(route).toMatch(
      /listGalleryItemsFromSources\([\s\S]*favoritesOnly/
    );
  });

  it("uses independent Favorites state and server query parameters", () => {
    const app = read(
      "app/app/AppPageClient.tsx",
    );

    expect(app).toContain(
      "galleryFavoritesOnly"
    );

    expect(app).toContain(
      "setGalleryFavoritesOnly"
    );

    expect(app).toContain(
      'params.set("favorite", "1")'
    );

    expect(app).toContain(
      'params.set("page", String(galleryPage))'
    );

    expect(app).toContain(
      'params.set("per", String(requestPer))'
    );

    expect(app).not.toContain(
      'params.set("per", "80")'
    );
  });

  it("uses API totals instead of paginating an 80-item client subset", () => {
    const app = read(
      "app/app/AppPageClient.tsx",
    );

    expect(app).toContain(
      "setGalleryTotalItems"
    );

    expect(app).toContain(
      "setGalleryTotalPages"
    );

    expect(app).toContain(
      "data?.total"
    );

    expect(app).toContain(
      "data?.totalPages"
    );

    expect(app).toContain(
      "const visibleGalleryItems = galleryItems;"
    );

    expect(app).not.toContain(
      "galleryItems.slice("
    );
  });

  it("passes Favorites filtering and real totals into GalleryWorkspace", () => {
    const app = read(
      "app/app/AppPageClient.tsx",
    );

    const workspace = read(
      "app/app/components/GalleryWorkspace.tsx",
    );

    expect(app).toContain(
      "galleryFavoritesOnly={galleryFavoritesOnly}"
    );

    expect(app).toContain(
      "onGalleryFavoritesOnlyChange={setGalleryFavoritesOnly}"
    );

    expect(app).toContain(
      "galleryTotalItems={galleryTotalItems}"
    );

    expect(workspace).toContain(
      "galleryFavoritesOnly: boolean;"
    );

    expect(workspace).toContain(
      "onGalleryFavoritesOnlyChange: (value: boolean) => void;"
    );

    expect(workspace).toContain(
      "galleryTotalItems: number;"
    );
  });

  it("renders Favorites as a separate Heart filter, not a sort mode", () => {
    const workspace = read(
      "app/app/components/GalleryWorkspace.tsx",
    );

    expect(workspace).toContain(
      'data-otg="gallery-favorites-filter"'
    );

    expect(workspace).toContain(
      "aria-pressed={galleryFavoritesOnly}"
    );

    expect(workspace).toContain(
      "onGalleryFavoritesOnlyChange(!galleryFavoritesOnly)"
    );

    expect(workspace).toContain(
      "Favorites"
    );

    expect(workspace).not.toContain(
      '<option value="favorites">'
    );

    expect(workspace).not.toContain(
      '<option value="favorited">'
    );
  });

  it("keeps Newest, Oldest, and Name as the Gallery sort modes", () => {
    const workspace = read(
      "app/app/components/GalleryWorkspace.tsx",
    );

    expect(workspace).toContain(
      '<option value="newest">Newest first</option>'
    );

    expect(workspace).toContain(
      '<option value="oldest">Oldest first</option>'
    );

    expect(workspace).toContain(
      '<option value="name">Name</option>'
    );
  });

  it("resets pagination when the Favorites filter changes", () => {
    const app = read(
      "app/app/AppPageClient.tsx",
    );

    expect(app).toMatch(
      /setGalleryPage\(1\)[\s\S]{0,500}galleryFavoritesOnly|galleryFavoritesOnly[\s\S]{0,500}setGalleryPage\(1\)/
    );
  });

  it("refreshes the server-filtered page after changing a Heart", () => {
    const app = read(
      "app/app/AppPageClient.tsx",
    );

    const start = app.indexOf(
      "async function handleGalleryFavorite"
    );

    const end = app.indexOf(
      "async function handleGalleryRename",
      start,
    );

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const handler = app.slice(start, end);

    expect(handler).toContain(
      'fetch("/api/gallery/favorite"'
    );

    expect(handler).toContain(
      "await loadGallery();"
    );
  });
});

describe("Gallery stale-code cleanup contract", () => {
  it("removes the unused legacy Gallery component layer", () => {
    const removed = [
      "app/components/GalleryActions.tsx",
      "app/components/GalleryAutoPanel.tsx",
      "app/components/GalleryGridMinimal.tsx",
      "app/components/GalleryGrid.tsx",
      "app/components/GalleryItemActions.tsx",
      "app/components/GalleryVirtualList.tsx",
      "app/components/useAutoSyncGalleryOnComplete.ts",
      "app/app/components/GalleryAutoPanel.tsx",
      "app/app/components/GalleryVirtualList.tsx",
    ];

    for (const relativePath of removed) {
      expect(
        exists(relativePath),
        relativePath,
      ).toBe(false);
    }
  });

  it("removes the obsolete favorited Gallery sort mode", () => {
    const gallery = read(
      "lib/gallery.ts",
    );

    expect(gallery).not.toContain(
      '"favorited"'
    );

    expect(gallery).not.toContain(
      'sort === "favorited"'
    );
  });
});

describe("Gallery legacy support-module cleanup contract", () => {
  it("removes unreferenced legacy Gallery support modules", () => {
    const removed = [
      "app/lib/galleryWatcher.ts",
      "lib/galleryFs.ts",
      "lib/galleryIndex.ts",
      "lib/galleryScan.ts",
    ];

    for (const relativePath of removed) {
      expect(
        exists(relativePath),
        relativePath,
      ).toBe(false);
    }
  });

  it("preserves the Gallery support modules with active callers", () => {
    expect(
      exists("lib/galleryThumbs.ts"),
    ).toBe(true);

    expect(
      exists("lib/comfyGallerySync.ts"),
    ).toBe(true);

    expect(
      exists("lib/adminGallerySources.ts"),
    ).toBe(true);
  });
});
