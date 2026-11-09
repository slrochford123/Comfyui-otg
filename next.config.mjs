import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Deliberately avoid HSTS on the HTTP/Tailscale TEST origin. Scripts,
      // media/blob previews and Android microphone behavior remain compatible.
      { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'self'" },
    ] }];
  },

  // Allow test-dev access over Tailscale without Next dev asset origin warnings.
  allowedDevOrigins: ["100.76.179.83", "*.ts.net"],

  // Create a self-contained production artifact under .next/standalone.
  // This enables build-once / promote-the-same-artifact deployments.
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/timeline-editor/app/**": ["./timeline-editor/**/*"],
  },

  // Force Next.js to treat THIS folder as the workspace root even if there are
  // multiple lockfiles elsewhere. This stabilizes builds/starts.
  outputFileTracingRoot: __dirname,

  // Serve images directly — avoids sharp dependency issues and works
  // reliably behind Cloudflare Tunnel with output: "standalone".
  images: {
    unoptimized: true,
  },

  // Keep production builds from failing because of ESLint warnings/errors
  eslint: {
    ignoreDuringBuilds: true,
  },

  webpack(config) {
    // Prevent Next from bundling Storybook story files
    config.module.rules.push({
      test: /\\.stories\\.(ts|tsx|js|jsx)$/,
      loader: "ignore-loader",
    });
    return config;
  },

  // IMPORTANT:
  // Do NOT set basePath/assetPrefix unless you *really* deploy under a subpath.
  // Your Cloudflare Tunnel should route the hostname to http://127.0.0.1:3000
  // and you should browse: https://comf-otg.comfyui-otg.win/login
};

export default nextConfig;
