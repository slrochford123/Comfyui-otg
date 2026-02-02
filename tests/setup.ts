import "@testing-library/jest-dom";
import React from "react";
import { vi } from "vitest";

// --- Next.js stubs for Vitest (so components can render outside Next runtime) ---

// next/image -> render plain img
vi.mock("next/image", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      const { src, alt, ...rest } = props;
      // eslint-disable-next-line jsx-a11y/alt-text
      return React.createElement("img", { src: typeof src === "string" ? src : (src?.src ?? ""), alt, ...rest });
    },
  };
});

// next/link -> render plain anchor
vi.mock("next/link", () => {
  return {
    __esModule: true,
    default: ({ href, children, ...rest }: any) => {
      return React.createElement("a", { href: typeof href === "string" ? href : (href?.pathname ?? "#"), ...rest }, children);
    },
  };
});

// next/navigation -> minimal hooks
vi.mock("next/navigation", () => {
  return {
    __esModule: true,
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
    }),
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
  };
});
