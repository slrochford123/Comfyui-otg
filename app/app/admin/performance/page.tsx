import PerformanceClient from "../../../admin/performance/PerformanceClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AppAdminPerformancePage() {
  return <PerformanceClient />;
}
