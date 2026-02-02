# Fix page.tsx import syntax error

This patch removes an invalid escaped-quote import line and replaces the duplicate imports with a single correct TypeScript import.

## Option A (recommended): apply patch with git
From your project root:

    git apply fix_page_imports.patch

Then run:

    npm run build

## Option B (manual)
Open: app/app/page.tsx
Find this broken line and DELETE it:

    import type { VideoProfileSelection } from \"../lib/videoProfiles\";

Also remove the duplicate import below it, and keep ONE correct line like:

    import type { VideoProfileSelection, VideoProfileConstraints } from "../lib/videoProfiles";
