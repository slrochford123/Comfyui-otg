import "./globals.css";
import { FloatingQueueProvider } from "./components/FloatingQueueProvider";
import { FloatingQueueWidget } from "./components/FloatingQueueWidget";

// NOTE:
// We intentionally do NOT declare <html>/<body> here.
// The root app/layout.tsx owns the document shell (background, BuildBadge, etc.).
// This nested layout only provides a lightweight wrapper for the /app route.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FloatingQueueProvider>
      <FloatingQueueWidget />
      {children}
    </FloatingQueueProvider>
  );
}
