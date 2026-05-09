import HealthClient from '../../../admin/health/HealthClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function AppAdminHealthPage() {
  return <HealthClient />;
}
