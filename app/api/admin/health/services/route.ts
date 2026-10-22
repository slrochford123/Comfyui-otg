import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_requireAdmin';
import { checkAllServices, getServiceRegistry } from '@/lib/services/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
  }

  const registry = getServiceRegistry();
  const services = await checkAllServices(registry);
  const ok = services.filter((s) => s.ok).length;
  return NextResponse.json(
    {
      ok: true,
      summary: { ok, total: services.length },
      services,
      checkedAt: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
