import AdminUsersClient from "./users-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminUsersPage() {
  return (
    <main className="otg-authPage">
      <div className="otg-authBg" />
      <section className="otg-authCard2" style={{ maxWidth: 920 }}>
        <h1 className="otg-authTitle" style={{ marginBottom: 6 }}>Admin • Users</h1>
        <p className="otg-authSub" style={{ marginBottom: 16 }}>
          View registered accounts. (Admins only)
        </p>
        <AdminUsersClient />
      </section>
    </main>
  );
}
