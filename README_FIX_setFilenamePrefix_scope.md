# Fix: setFilenamePrefix not in scope in app/api/comfy/route.ts

## Symptom
Type check fails even though a `function setFilenamePrefix(...)` exists elsewhere in the file:
`Cannot find name 'setFilenamePrefix'` at the call site.

This usually means the existing function is inside a narrower scope (e.g., inside another function/block),
so the call site can't see it.

## What this patch does
- Replaces the call `setFilenamePrefix(graph, title);` with `setFilenamePrefix__otg(graph, title);`
- Inserts a module-scope helper `setFilenamePrefix__otg` after the import block.

## Apply
```powershell
cd C:\AI\OTG-Test
Set-ExecutionPolicy -Scope Process Bypass
.\FIX_setFilenamePrefix_scope.ps1 -RepoRoot .
```

## Rebuild
```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
npm run start -- -p 3001
```
