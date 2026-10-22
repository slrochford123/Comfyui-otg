import "./globals.css";
import "./slr-overrides.css";
import "./light-theme.css";
import "./launch-intro.css";
import LaunchIntro from "./components/LaunchIntro";
import ThemeBootstrap from "./components/ThemeBootstrap";

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
    root.classList.toggle("dark", mode === "dark");
    if (mode === "light") {
      const light = { surface: "#e9ecf3", "surface-elevated": "#faf9fc", card: "#f8f7fb", border: "#cbd1dd", "text-muted": "#555e70", success: "#15803d", warning: "#b45309", error: "#b91c1c", info: "#0369a1", shadow: "0 6px 24px rgba(35,42,62,.07)" };
      for (const [key, value] of Object.entries(light)) root.style.setProperty("--color-" + key, value);
    }
    root.style.setProperty("--color-background", mode === "light" ? "#f2f3f7" : "#070912");
    root.style.setProperty("--color-text", mode === "light" ? "#242a38" : "#f8fafc");
  } catch {}
})();
`;

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata = {
  title: "SLR Studios",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  appleWebApp: { capable: true, title: "SLR Studios", statusBarStyle: "black-translucent" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="otg-app otg-shell">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <LaunchIntro />
        <ThemeBootstrap />
        {children}

        {/* Build marker (for support + screenshots) */}
      </body>
    </html>
  );
}
