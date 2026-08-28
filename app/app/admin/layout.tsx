import { redirect } from "next/navigation";
import { requireAdmin } from "@/app/api/admin/_requireAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    redirect("/app?reason=forbidden");
  }
  return children;
}
