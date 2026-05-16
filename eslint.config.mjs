import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "dist/**",
      "build/**",
      "android/app/build/**",
      "android/app/src/main/assets/public/**/*.js",
      "android/capacitor-cordova-android-plugins/build/**",
      "files/**",
      "_otg_patch_backups/**",
      ".otg_backups/**",
      ".codex-backups/**",
      ".aider.tags.cache.v4/**",
      "otg-clean-reapply-kit/**",
      "otg-improvements-kit/**",
      "playwright-report/**",
      "test-results/**",
      "tmp/**",
      "scripts/**",
      "tools/**",
      "src/stories/**",
      "components/**/*.stories.*",
      "patch_full_feature_batch/**",
      "*.bak",
      "*.bak_*",
      "*.zip",
      "public/**/*.js",
      "services/**",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  {
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "prefer-const": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react/no-unescaped-entities": "warn",
      "@next/next/no-img-element": "warn",
    },
  },
];
