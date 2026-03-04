Hotfix 005 — Force-dedupe EditPicturesGraph import (robust)

Fixes:
- next build fails: Identifier 'EditPicturesGraph' has already been declared
Even if the import lines differ by whitespace or quotes.

Apply:
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File .\apply-gallery-hotfix-005-dedupe-editpictures-import.ps1 -RepoRoot "C:\AI\OTG-Test"

Then:
npm run build
