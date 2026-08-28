import "./globals.css";
import AppQueryProvider from "./components/AppQueryProvider";
import { FloatingQueueProvider } from "./components/FloatingQueueProvider";
import { FloatingQueueWidget } from "./components/FloatingQueueWidget";

// NOTE:
// We intentionally do NOT declare <html>/<body> here.
// The root app/layout.tsx owns the document shell (background, BuildBadge, etc.).
// This nested layout only provides a lightweight wrapper for the /app route.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppQueryProvider>
      <FloatingQueueProvider>
        <FloatingQueueWidget />
        {children}
      </FloatingQueueProvider>
    </AppQueryProvider>
  );
}
