import "./globals.css";

// NOTE:
// We intentionally do NOT declare <html>/<body> here.
// The root app/layout.tsx owns the document shell (background, BuildBadge, etc.).
// This nested layout only provides a lightweight wrapper for the /app route.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
