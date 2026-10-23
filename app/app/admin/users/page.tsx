import AdminUsersClient from "../../../admin/users/users-client";
import AdminShell from "../AdminShell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminUsersPageInApp() {
  return (
    <AdminShell title="Users" description="Registered accounts and supported account-management actions.">
        <AdminUsersClient />
    </AdminShell>
  );
}
