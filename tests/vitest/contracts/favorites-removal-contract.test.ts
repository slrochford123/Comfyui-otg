import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function absolute(relativePath: string) {
  return path.join(ROOT, relativePath);
}

function exists(relativePath: string) {
  return fs.existsSync(absolute(relativePath));
}

function read(relativePath: string) {
  return fs.readFileSync(
    absolute(relativePath),
    "utf8",
  );
}

describe("Favorites removal contract", () => {
  it("removes the dedicated Favorites navigation and app tab", () => {
    const nav = read(
      "app/app/components/SpinDialNav.tsx",
    );

    expect(nav).not.toContain('| "favorites"');
    expect(nav).not.toContain(
      '{ id: "favorites", label: "Favorites" }',
    );

    const app = read(
      "app/app/AppPageClient.tsx",
    );

    expect(app).not.toContain(
      'favorites: "Favorites"',
    );
    expect(app).not.toContain(
      'tab === "favorites"',
    );
    expect(app).not.toContain(
      'tab !== "gallery" && tab !== "favorites"',
    );
    expect(app).not.toContain(
      'tabParam === "favorites"',
    );
  });

  it("removes dedicated Favorites client state and loading", () => {
    const app = read(
      "app/app/AppPageClient.tsx",
    );

    const forbidden = [
      'fetch("/api/favorites"',
      "loadFavorites",
      "favoriteItems",
      "favoritesBusy",
      "favoritesFilter",
      "favoritesSort",
      "favoritesViewMode",
      "favoritesSearch",
      "favoritesItemsPerPage",
      "favoritesPage",
      "visibleFavoriteItems",
      "favoriteItemKeySet",
      'collection: tab === "favorites"',
      'viewerState.collection === "favorites"',
    ];

    for (const token of forbidden) {
      expect(
        app,
        `Dedicated Favorites client token remains: ${token}`,
      ).not.toContain(token);
    }

    // Gallery heart/favorite metadata remains intentionally.
    expect(app).toContain(
      'fetch("/api/gallery/favorite"',
    );
    expect(app).toContain(
      "item.meta?.favorite",
    );
  });

  it("removes the Favorites branch from GalleryWorkspace while keeping Gallery heart actions", () => {
    const source = read(
      "app/app/components/GalleryWorkspace.tsx",
    );

    const forbidden = [
      'activeTab === "favorites"',
      'activeTab !== "gallery" && activeTab !== "favorites"',
      "visibleFavoriteItems",
      "favoriteItems:",
      "favoritesRawCount",
      "favoritesFilter",
      "favoritesSort",
      "favoritesViewMode",
      "favoritesSearch",
      "favoritesItemsPerPage",
      "favoritesPage",
      "favoritesTotalPages",
      "onRefreshFavorites",
      ">Favorites</h1>",
      "No favorites yet.",
      "Search favorites by name",
    ];

    for (const token of forbidden) {
      expect(
        source,
        `Favorites workspace token remains: ${token}`,
      ).not.toContain(token);
    }

    expect(source).toContain(
      "onFavorite",
    );
    expect(source).toContain(
      "meta?.favorite",
    );
  });

  it("removes dedicated and obsolete Favorites APIs", () => {
    const removed = [
      "app/api/favorites/route.ts",
      "app/api/favorites/add/route.ts",
      "app/api/favorites/delete/route.ts",
      "app/api/favorites/file/route.ts",
      "app/app/api/favorites/delete/route.ts",
      "app/api/content/favorite/route.ts",
    ];

    for (const relativePath of removed) {
      expect(
        exists(relativePath),
        `Favorites-only route still exists: ${relativePath}`,
      ).toBe(false);
    }

    expect(
      exists("app/api/gallery/favorite/route.ts"),
    ).toBe(true);
  });

  it("decouples active shared routes from the removed physical Favorites collection", () => {
    const thumb = read(
      "app/api/thumb/route.ts",
    );

    expect(thumb).not.toContain(
      '"gallery" | "favorites"',
    );
    expect(thumb).not.toContain(
      'collection !== "favorites"',
    );
    expect(thumb).not.toContain(
      "user_favorites",
    );
    expect(thumb).not.toContain(
      "device_favorites",
    );

    const backgrounds = read(
      "app/api/backgrounds/route.ts",
    );

    expect(backgrounds).not.toContain(
      "ownerDirs.favorites",
    );

    const studioSend = read(
      "app/api/studio/send/route.ts",
    );

    expect(studioSend).not.toContain(
      '"gallery" | "favorites"',
    );

    const studioUpload = read(
      "app/api/studio/upload-to-comfy/route.ts",
    );

    expect(studioUpload).not.toContain(
      "userFavoritesDir",
    );
    expect(studioUpload).not.toContain(
      'source === "favorites"',
    );
  });

  it("removes stale legacy Favorites navigation", () => {
    const appShell = read(
      "app/components/AppShell.tsx",
    );

    expect(appShell).not.toContain(
      '/app/favorites',
    );

    const bottomNav = read(
      "app/app/components/BottomNav.tsx",
    );

    expect(bottomNav).not.toContain(
      '| "favorites"',
    );
    expect(bottomNav).not.toContain(
      'item("favorites", "Favorites")',
    );
  });

  it("removes obsolete current-content favorited state", () => {
    expect(
      read("lib/contentState.ts"),
    ).not.toContain("favorited");

    expect(
      read("app/api/content/last/route.ts"),
    ).not.toContain("favorited");
  });

  it("preserves Gallery favorite metadata and mutation behavior", () => {
    const route = read(
      "app/api/gallery/favorite/route.ts",
    );

    expect(route).toContain(
      "writeMetaForFile",
    );
    expect(route).toContain(
      "favorite: nextFavorite",
    );

    const gallery = read(
      "lib/gallery.ts",
    );

    expect(gallery).toContain(
      "favorite?: boolean",
    );
    expect(gallery).toContain(
      "patch.favorite",
    );

    expect(
      exists("app/api/gallery/favorite/route.ts"),
    ).toBe(true);
  });

  it("removes dead physical Favorites compatibility helpers from runtime libraries", () => {
    expect(
      exists("lib/galleryMeta.ts"),
    ).toBe(false);

    const paths = read("lib/paths.ts");

    const forbidden = [
      "getUserFavoritesRoot",
      "getDeviceFavoritesRoot",
      "deviceFavoritesDir",
      "userFavoritesDir",
      "favorites: string;",
      "userFavoritesDir: string;",
      "user_favorites",
      "device_favorites",
    ];

    for (const token of forbidden) {
      expect(
        paths,
        `Legacy physical Favorites path helper remains: ${token}`,
      ).not.toContain(token);
    }
  });

  it("removes dedicated Favorites support/help copy", () => {
    const support = read(
      "app/app/components/SupportPanel.tsx",
    );

    expect(support).not.toContain(
      '"Favorites",',
    );
    expect(support).not.toContain(
      "<b>Favorites</b>",
    );
    expect(support).not.toContain(
      "Gallery or Favorites",
    );
    expect(support).not.toContain(
      "Favorites only shows",
    );
  });
});
