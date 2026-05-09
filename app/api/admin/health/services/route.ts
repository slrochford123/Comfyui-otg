import { NextResponse } from 'next/server';
import { checkAllServices, getServiceRegistry } from '@/lib/services/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
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
