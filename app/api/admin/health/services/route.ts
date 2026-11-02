import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_requireAdmin';
import { checkAllServices, getServiceRegistry } from '@/lib/services/registry';
import { statfs } from 'node:fs/promises';
import { OTG_DATA_ROOT } from '@/lib/paths';
import { storageHeadroom } from '@/lib/storageAdmission';
import { capabilities } from '@/lib/audioEditing/jobs';
import { readBuildIdentity } from '@/lib/buildIdentityServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
  }

  const registry = getServiceRegistry();
  const services = await checkAllServices(registry);
  const storage = await statfs(OTG_DATA_ROOT).then(info => ({ available: true, freeBytes: info.bavail * info.bsize, totalBytes: info.blocks * info.bsize,
    ...storageHeadroom(OTG_DATA_ROOT), scope: 'application-data-volume', warning: info.bavail / Math.max(1, info.blocks) < 0.1 ? 'Less than 10% storage remains. Review capacity; no media has been deleted.' : null }), () => ({ available: false, freeBytes: null, totalBytes: null }));
  const enabled = services.filter((s) => s.enabled && s.configured);
  const ok = enabled.filter((s) => s.ok).length;
  return NextResponse.json(
    {
      ok: true,
      summary: { ok, total: enabled.length, notConfigured: services.filter(s => !s.configured).length, disabled: services.filter(s => !s.enabled).length, requiredFailures: services.filter(s => s.required && (!s.enabled || !s.configured || !s.ok)).length },
      services,
      storage,
      build: readBuildIdentity(),
      audio: capabilities(),
      checkedAt: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
