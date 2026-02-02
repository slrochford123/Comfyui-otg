import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sbDir = path.join(root, '.storybook');

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function backupIfRedundant(jsFile, tsFile) {
  const jsPath = path.join(sbDir, jsFile);
  const tsPath = path.join(sbDir, tsFile);

  if (!exists(jsPath)) return;
  if (!exists(tsPath)) return;

  const backupPath = jsPath + '.bak';
  try {
    // If a previous backup exists, overwrite it.
    if (exists(backupPath)) fs.rmSync(backupPath, { force: true });
    fs.renameSync(jsPath, backupPath);
    console.log(`[OTG] Storybook cleanup: moved ${path.join('.storybook', jsFile)} -> ${path.join('.storybook', jsFile + '.bak')} (using ${tsFile}).`);
  } catch (err) {
    console.warn(`[OTG] Storybook cleanup: failed to move ${jsFile}:`, err);
  }
}

function removeIfRedundant(file, keepFile) {
  const p = path.join(sbDir, file);
  const keep = path.join(sbDir, keepFile);
  if (!exists(p)) return;
  if (!exists(keep)) return;
  try {
    fs.rmSync(p, { force: true });
    console.log(`[OTG] Storybook cleanup: removed ${path.join('.storybook', file)} (using ${keepFile}).`);
  } catch (err) {
    console.warn(`[OTG] Storybook cleanup: failed to remove ${file}:`, err);
  }
}

if (exists(sbDir)) {
  // Most common local-regression: leftover JS configs when the repo uses TS.
  backupIfRedundant('main.js', 'main.ts');
  backupIfRedundant('preview.js', 'preview.ts');

  // Occasionally Storybook generators leave ESM variants behind.
  backupIfRedundant('main.mjs', 'main.ts');
  backupIfRedundant('preview.mjs', 'preview.ts');

  // Also handle CommonJS variants if someone generated them.
  removeIfRedundant('main.cjs', 'main.ts');
  removeIfRedundant('preview.cjs', 'preview.ts');
}
