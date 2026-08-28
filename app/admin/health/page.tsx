import HealthClient from './HealthClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function AdminHealthPage() {
  return <HealthClient />;
}
