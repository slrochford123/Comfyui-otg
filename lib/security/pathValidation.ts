import path from 'node:path';

export const DEFAULT_MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.m4a', '.ogg', '.json',
]);

export function normalizeRelativePath(input: string): string {
  const raw = String(input || '').replace(/\\/g, '/').trim();
  if (!raw) throw new Error('Path is required.');
  if (raw.includes('\0')) throw new Error('Path contains a null byte.');
  if (/^[a-zA-Z]:\//.test(raw)) throw new Error('Absolute Windows paths are not allowed.');
  if (raw.startsWith('/') || raw.startsWith('//')) throw new Error('Absolute paths are not allowed.');

  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.') throw new Error('Path is required.');
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('Path traversal is not allowed.');
  return normalized;
}

export function resolveInsideRoot(root: string, userPath: string, opts: { allowedExtensions?: Set<string> | string[] } = {}) {
  const rel = normalizeRelativePath(userPath);
  const allowed = opts.allowedExtensions
    ? new Set(Array.isArray(opts.allowedExtensions) ? opts.allowedExtensions : Array.from(opts.allowedExtensions))
    : DEFAULT_MEDIA_EXTENSIONS;
  const ext = path.extname(rel).toLowerCase();
  if (allowed.size && !allowed.has(ext)) throw new Error(`File extension is not allowed: ${ext || '(none)'}`);

  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, rel);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(prefix)) {
    throw new Error('Resolved path escaped the allowed root.');
  }
  return { relativePath: rel, absolutePath: resolvedPath };
}

export function safeFilename(input: string, fallback = 'file') {
  const cleaned = String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 180);
  if (!cleaned || cleaned === '.' || cleaned === '..') return fallback;
  return cleaned;
}
