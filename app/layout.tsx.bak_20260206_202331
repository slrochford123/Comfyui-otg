import "./globals.css";
import "./slr-overrides.css";
import BuildBadge from "./components/BuildBadge";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="otg-app otg-shell">
        {children}

        {/* Build marker (for support + screenshots) */}
        <BuildBadge />
      </body>
    </html>
  );
}
