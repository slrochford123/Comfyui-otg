import AdminFeedbackClient from "./feedback-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminFeedbackPage() {
  return (
    <main className="otg-authPage">
      <div className="otg-authBg" />
      <section className="otg-authCard2" style={{ maxWidth: 980 }}>
        <h1 className="otg-authTitle" style={{ marginBottom: 6 }}>Admin • Feedback</h1>
        <p className="otg-authSub" style={{ marginBottom: 16 }}>
          Latest user feedback notes. (Admins only)
        </p>
        <AdminFeedbackClient />
      </section>
    </main>
  );
}
