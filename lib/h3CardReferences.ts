import type { CharacterRecord } from "@/lib/characters/store";

export type H3CardImage = { id: string; label: string; path: string; look?: string };
export type H3CardReference = { characterId: string; imageId: string; version: string };

export function h3CardImages(card: CharacterRecord): H3CardImage[] {
  const views = card.metadata?.extractedViews;
  const extracted = Array.isArray(views) ? views.filter((view): view is H3CardImage =>
    !!view && typeof view.id === "string" && typeof view.label === "string" && typeof view.path === "string") : [];
  const body = card.characterReferences?.body;
  const candidates: H3CardImage[] = [
    { id: "primary", label: "Approved primary image", path: card.defaultCharacterImagePath || card.fullBodyImagePath || card.imagePath },
    {id:"original-extraction",label:"Original extracted image",path:card.originalSourceImagePath||""},
    ...extracted,
    { id: "card", label: "Reference sheet", path: card.characterCardWorkflowImagePath || card.characterReferences?.characterCard?.serverPath || card.characterCardPath || "" },
    ...Object.entries(body || {}).map(([id, view]) => ({ id: "view-" + id, label: id.replace(/Profile$/, " profile"), path: view?.serverPath || "" })),
  ];
  return candidates.filter((image, index) => !!image.path && candidates.findIndex(other => other.path === image.path) === index);
}
