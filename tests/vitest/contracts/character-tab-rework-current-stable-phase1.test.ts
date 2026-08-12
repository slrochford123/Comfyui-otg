// @vitest-environment node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const sha256 = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

describe("current-stable Character tab Phase 1", () => {
  it("preserves the entire current stable Characters implementation unchanged", () => {
    const legacy = read("app/app/components/CharactersPanel.tsx");

    expect(sha256(legacy)).toBe(
      "ad525366b14b0ef070b49670cfa5cf482e8c45eef2d99def44ab834003677588"
    );

    expect(legacy).toContain("Character completion queued.");
    expect(legacy).toContain("Generate Full-Body Character");
    expect(legacy).toContain("Create Character Card");
  });

  it("routes the user-facing Characters tab through the new hub and existing admin state", () => {
    const app = read("app/app/AppPageClient.tsx");

    expect(app).toContain(
      'const CharactersPanel = dynamic(() => import("./components/CharacterHubPanel"), { loading: PanelLoading });'
    );

    expect(app).toContain(
      '{tab === "characters" ? <CharactersPanel isAdmin={isAdmin} /> : null}'
    );

    expect(app).toContain(
      "const [isAdmin, setIsAdmin] = useState(Boolean(initialUser?.admin));"
    );
  });

  it("mounts current CharactersPanel only as admin-only Legacy Characters", () => {
    const hub = read("app/app/components/CharacterHubPanel.tsx");

    expect(hub).toContain(
      'import LegacyCharactersPanel from "./CharactersPanel";'
    );
    expect(hub).toContain("Legacy Characters — Admin");
    expect(hub).toContain("if (!isAdmin)");
    expect(hub).toContain(
      "Legacy Characters is restricted to administrators."
    );
    expect(hub).toContain("<LegacyCharactersPanel />");
  });

  it("provides the three top-level galleries", () => {
    const hub = read("app/app/components/CharacterHubPanel.tsx");

    expect(hub).toContain('title="Character Gallery"');
    expect(hub).toContain('title="Background Gallery"');
    expect(hub).toContain('title="Asset Gallery"');
  });

  it("provides the four Character Gallery entry paths", () => {
    const hub = read("app/app/components/CharacterHubPanel.tsx");

    expect(hub).toContain('title="Create Character"');
    expect(hub).toContain('title="Create Freeform Character"');
    expect(hub).toContain('title="Upload Character"');
    expect(hub).toContain('title="Upload Freeform Character"');
  });

  it("preserves Phase 1 placeholders while approved Create wiring advances", () => {
    const hub = read("app/app/components/CharacterHubPanel.tsx");

    expect(hub).toContain("Approval checkpoint");
    expect(hub).toContain("Layout only.");
    // Approved Create Character / Create Freeform Character work has
    // advanced beyond the original Phase 1 navigation-only checkpoint.
    expect(hub).toContain('fetch("/api/characters/create-image"');
    expect(hub).toContain("/api/comfy/history-image?");
    expect(hub).toContain("Generate Character");
  });

  it("gives Characters a distinct light-blue navigation identity", () => {
    const nav = read("app/app/components/SpinDialNav.tsx");

    expect(nav).toContain(
      'const isCharacterTab = item.id === "characters";'
    );
    expect(nav).toContain("!bg-sky-300");
    expect(nav).toContain("!text-sky-100");
  });
});
