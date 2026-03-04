// Client-safe clipboard helper with a mobile-friendly fallback.
//
// Why:
// - navigator.clipboard.writeText is not available in all browsers
//   (or may require secure context / permissions).
// - iOS Safari frequently blocks it unless conditions are perfect.

export async function copyTextToClipboard(text: string): Promise<boolean> {
  const t = (text ?? "").toString();
  if (!t) return false;

  // Modern API (secure contexts).
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {
    // fall through
  }

  // Fallback: hidden textarea + execCommand.
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}
