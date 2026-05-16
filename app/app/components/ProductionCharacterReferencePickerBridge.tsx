"use client";

import { useEffect } from "react";

type CharacterPickerItem = {
  id: string;
  name: string;
  imagePath: string;
  imageUrl: string;
};

function textOf(el: Element | null): string {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function fileUrlForCharacterPath(imagePath: string): string {
  return `/api/file?path=${encodeURIComponent(imagePath)}`;
}

function normalizeCharacters(payload: unknown): CharacterPickerItem[] {
  const data = payload as any;

  const raw: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.characters)
      ? data.characters
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.data)
          ? data.data
          : [];

  const seen = new Set<string>();

  return raw
    .map((entry, index) => {
      const imagePath = String(entry?.imagePath || "").trim();
      const name = String(
        entry?.name ||
        entry?.title ||
        entry?.label ||
        entry?.id ||
        `Character ${index + 1}`
      ).trim();

      return {
        id: String(entry?.id || imagePath || name || index),
        name,
        imagePath,
        imageUrl: imagePath ? fileUrlForCharacterPath(imagePath) : "",
      };
    })
    .filter((item) => {
      if (!item.imagePath || !item.imageUrl) return false;
      if (seen.has(item.imagePath)) return false;
      seen.add(item.imagePath);
      return true;
    });
}

function safeFileName(name: string, mime: string): string {
  const ext = mime.includes("jpeg")
    ? "jpg"
    : mime.includes("webp")
      ? "webp"
      : mime.includes("gif")
        ? "gif"
        : "png";

  const base =
    String(name || "character")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "character";

  return `${base}.${ext}`;
}

async function loadCharacters(): Promise<CharacterPickerItem[]> {
  const res = await fetch("/api/characters", {
    cache: "no-store",
    credentials: "include",
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : `Could not load characters (${res.status}).`);
  }

  return normalizeCharacters(data);
}

async function characterToFile(item: CharacterPickerItem): Promise<File> {
  const res = await fetch(item.imageUrl, {
    cache: "no-store",
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`Could not load character image (${res.status}).`);
  }

  const blob = await res.blob();

  if (!String(blob.type || "").startsWith("image/")) {
    throw new Error("Selected character is not an image.");
  }

  const mime = blob.type || "image/png";
  return new File([blob], safeFileName(item.name, mime), { type: mime });
}

function assignFileToInput(input: HTMLInputElement, file: File): void {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function ProductionCharacterReferencePickerBridge() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const patchAttr = "data-otg-production-character-picker";
    const styleId = "otg-production-character-picker-style";

    function ensureStyle() {
      if (document.getElementById(styleId)) return;

      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .otg-production-character-picker-button {
          display: inline-flex;
          width: 100%;
          min-height: 44px;
          align-items: center;
          justify-content: center;
          border-radius: 14px;
          border: 1px solid rgba(34, 211, 238, 0.25);
          background: rgba(6, 182, 212, 0.10);
          color: rgb(207, 250, 254);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
        }
        .otg-production-character-picker-button:hover {
          background: rgba(6, 182, 212, 0.16);
        }
        .otg-production-character-picker-overlay {
          position: fixed;
          inset: 0;
          z-index: 99999;
          background: rgba(0,0,0,0.82);
          padding: 24px 16px;
          overflow-y: auto;
          backdrop-filter: blur(8px);
        }
        .otg-production-character-picker-modal {
          margin: 0 auto;
          max-width: 980px;
          max-height: 86vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          border: 1px solid rgba(34, 211, 238, 0.22);
          border-radius: 28px;
          background: #070b16;
          color: white;
          box-shadow: 0 0 60px rgba(0,0,0,0.55);
        }
        .otg-production-character-picker-header {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 12px;
          border-bottom: 1px solid rgba(255,255,255,0.10);
          padding: 18px 20px;
        }
        .otg-production-character-picker-title {
          font-size: 18px;
          font-weight: 800;
        }
        .otg-production-character-picker-subtitle {
          margin-top: 4px;
          font-size: 13px;
          color: rgba(255,255,255,0.58);
        }
        .otg-production-character-picker-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .otg-production-character-picker-action {
          min-height: 40px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.06);
          color: white;
          padding: 8px 14px;
          font-weight: 700;
          cursor: pointer;
        }
        .otg-production-character-picker-body {
          min-height: 260px;
          overflow-y: auto;
          padding: 20px;
        }
        .otg-production-character-picker-message {
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 18px;
          background: rgba(255,255,255,0.04);
          padding: 16px;
          color: rgba(255,255,255,0.70);
          font-size: 14px;
        }
        .otg-production-character-picker-error {
          border-color: rgba(248,113,113,0.25);
          background: rgba(239,68,68,0.12);
          color: rgb(254,226,226);
        }
        .otg-production-character-picker-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
          gap: 12px;
        }
        .otg-production-character-picker-card {
          overflow: hidden;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.04);
          color: white;
          text-align: left;
          cursor: pointer;
        }
        .otg-production-character-picker-card:hover {
          border-color: rgba(34,211,238,0.40);
          background: rgba(255,255,255,0.08);
        }
        .otg-production-character-picker-card:disabled {
          cursor: wait;
          opacity: 0.6;
        }
        .otg-production-character-picker-card img {
          display: block;
          width: 100%;
          aspect-ratio: 1 / 1;
          object-fit: cover;
          background: rgba(0,0,0,0.45);
        }
        .otg-production-character-picker-card-label {
          border-top: 1px solid rgba(255,255,255,0.10);
          padding: 9px 10px;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `;

      document.head.appendChild(style);
    }

    function findProductionReferenceRoot(): Element | null {
      const candidates = Array.from(
        document.querySelectorAll("section, fieldset, article, form, div")
      );

      const matches = candidates
        .filter((el) => {
          const text = textOf(el);
          return (
            /character references/i.test(text) &&
            /motion notes/i.test(text) &&
            /choose/i.test(text) &&
            !!el.querySelector('input[type="file"], button, label')
          );
        })
        .sort((a, b) => textOf(a).length - textOf(b).length);

      return matches[0] || null;
    }

    function findCardRoots(root: Element): Element[] {
      const cards = Array.from(root.querySelectorAll("div"))
        .filter((el) => {
          const text = textOf(el);
          return /^([1-5]\s*)?Character\s+[1-5]\b/i.test(text) && /choose/i.test(text);
        })
        .sort((a, b) => textOf(a).length - textOf(b).length);

      const unique: Element[] = [];

      for (const card of cards) {
        if (unique.some((existing) => existing.contains(card) || card.contains(existing))) {
          continue;
        }
        unique.push(card);
      }

      return unique.slice(0, 5);
    }

    function findChooseHost(card: Element): HTMLElement | null {
      const buttonsAndLabels = Array.from(card.querySelectorAll("button, label")) as HTMLElement[];

      return (
        buttonsAndLabels.find((el) => /^choose$/i.test(textOf(el))) ||
        buttonsAndLabels.find((el) => /choose/i.test(textOf(el))) ||
        null
      );
    }

    function findFileInput(card: Element): HTMLInputElement | null {
      return card.querySelector('input[type="file"]') as HTMLInputElement | null;
    }

    async function openPicker(slotLabel: string, input: HTMLInputElement) {
      ensureStyle();

      const overlay = document.createElement("div");
      overlay.className = "otg-production-character-picker-overlay";

      const modal = document.createElement("div");
      modal.className = "otg-production-character-picker-modal";

      const header = document.createElement("div");
      header.className = "otg-production-character-picker-header";

      const titleWrap = document.createElement("div");

      const title = document.createElement("div");
      title.className = "otg-production-character-picker-title";
      title.textContent = `Choose Character for ${slotLabel}`;

      const subtitle = document.createElement("div");
      subtitle.className = "otg-production-character-picker-subtitle";
      subtitle.textContent = "Uses saved Characters tab images for this Production reference slot.";

      titleWrap.appendChild(title);
      titleWrap.appendChild(subtitle);

      const actions = document.createElement("div");
      actions.className = "otg-production-character-picker-actions";

      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "otg-production-character-picker-action";
      refresh.textContent = "Refresh";

      const close = document.createElement("button");
      close.type = "button";
      close.className = "otg-production-character-picker-action";
      close.textContent = "Close";
      close.addEventListener("click", () => overlay.remove());

      actions.appendChild(refresh);
      actions.appendChild(close);

      header.appendChild(titleWrap);
      header.appendChild(actions);

      const body = document.createElement("div");
      body.className = "otg-production-character-picker-body";

      modal.appendChild(header);
      modal.appendChild(body);
      overlay.appendChild(modal);

      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) overlay.remove();
      });

      document.body.appendChild(overlay);

      const render = async () => {
        body.innerHTML = "";

        const loading = document.createElement("div");
        loading.className = "otg-production-character-picker-message";
        loading.textContent = "Loading saved characters...";
        body.appendChild(loading);

        try {
          const characters = await loadCharacters();

          body.innerHTML = "";

          if (!characters.length) {
            const empty = document.createElement("div");
            empty.className = "otg-production-character-picker-message";
            empty.textContent = "No saved characters with images were found.";
            body.appendChild(empty);
            return;
          }

          const grid = document.createElement("div");
          grid.className = "otg-production-character-picker-grid";

          characters.forEach((item) => {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "otg-production-character-picker-card";

            const img = document.createElement("img");
            img.src = item.imageUrl;
            img.alt = item.name;
            img.loading = "lazy";

            const label = document.createElement("div");
            label.className = "otg-production-character-picker-card-label";
            label.textContent = item.name;

            card.appendChild(img);
            card.appendChild(label);

            card.addEventListener("click", async () => {
              const cards = Array.from(grid.querySelectorAll("button"));
              cards.forEach((button) => ((button as HTMLButtonElement).disabled = true));
              label.textContent = "Selecting...";

              try {
                const file = await characterToFile(item);
                assignFileToInput(input, file);
                overlay.remove();
              } catch (error) {
                body.innerHTML = "";
                const err = document.createElement("div");
                err.className = "otg-production-character-picker-message otg-production-character-picker-error";
                err.textContent = error instanceof Error ? error.message : "Could not select character.";
                body.appendChild(err);
              }
            });

            grid.appendChild(card);
          });

          body.appendChild(grid);
        } catch (error) {
          body.innerHTML = "";
          const err = document.createElement("div");
          err.className = "otg-production-character-picker-message otg-production-character-picker-error";
          err.textContent = error instanceof Error ? error.message : "Could not load saved characters.";
          body.appendChild(err);
        }
      };

      refresh.addEventListener("click", () => void render());
      await render();
    }

    function attachButtons() {
      const root = findProductionReferenceRoot();
      if (!root) return;

      const cards = findCardRoots(root);

      cards.forEach((card, index) => {
        const chooseHost = findChooseHost(card);
        const input = findFileInput(card);

        if (!chooseHost || !input) return;
        if (card.querySelector(`[${patchAttr}]`)) return;

        const slotLabel = `Character ${index + 1}`;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "otg-production-character-picker-button";
        button.textContent = "From Characters";
        button.setAttribute(patchAttr, String(index + 1));
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void openPicker(slotLabel, input);
        });

        chooseHost.insertAdjacentElement("afterend", button);
      });
    }

    ensureStyle();
    attachButtons();

    const observer = new MutationObserver(() => attachButtons());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.querySelectorAll(`[${patchAttr}]`).forEach((el) => el.remove());
    };
  }, []);

  return null;
}