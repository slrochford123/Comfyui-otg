import "./globals.css";
import "./slr-overrides.css";

const themeInitScript = `
(() => {
  try {
    const presets = { purple: "#8b5cf6", blue: "#2563eb", yellow: "#d97706", red: "#dc2626", green: "#16a34a" };
    const legacy = { midnight: "purple", violet: "purple", ocean: "blue", ember: "red", forest: "green" };
    const rawTheme = localStorage.getItem("app-theme") || localStorage.getItem("otg:test:theme:v1") || "purple";
    const theme = legacy[rawTheme] || rawTheme;
    const mode = localStorage.getItem("app-color-mode") === "light" ? "light" : "dark";
    const custom = /^#[0-9a-f]{6}$/i.test(localStorage.getItem("app-custom-color") || "") ? localStorage.getItem("app-custom-color") : "#8b5cf6";
    const primary = theme === "custom" ? custom : presets[theme] || presets.purple;
    const root = document.documentElement;
    root.dataset.otgTheme = theme;
    root.dataset.otgColorMode = mode;
    root.style.colorScheme = mode;
    root.style.setProperty("--color-primary", primary);
    root.style.setProperty("--otg-accent", primary);
    root.style.setProperty("--color-background", mode === "light" ? "#f8fafc" : "#070912");
    root.style.setProperty("--color-text", mode === "light" ? "#0f172a" : "#f8fafc");
  } catch {}
})();
`;

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="otg-app otg-shell">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}

        {/* Build marker (for support + screenshots) */}
      </body>
    </html>
  );
}
