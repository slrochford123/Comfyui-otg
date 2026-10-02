import publishedMediaImport from "@/lib/h3StyleMediaManifest.json";

export type H3StyleMediaEntry = {
  poster?: string;
  previewVideo?: string;
  previewWebm?: string;
};

/**
 * Generated/published style media only. Keeping unavailable files out of this
 * manifest prevents the mobile selector from requesting dozens of 404s while
 * still allowing every style to function from its prompt metadata.
 */
const publishedMedia = (
  (publishedMediaImport as unknown as { default?: Record<string, H3StyleMediaEntry> }).default
  || publishedMediaImport
) as Record<string, H3StyleMediaEntry>;

export const H3_STYLE_MEDIA_MANIFEST: Readonly<Record<string, H3StyleMediaEntry>> = publishedMedia;
