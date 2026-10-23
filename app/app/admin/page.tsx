import AdminShell, { adminStyles as styles } from "./AdminShell";
import AdminSummary from "./AdminSummary";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const sections = [
  ["Users", "Inspect accounts, reset stuck generation state, and manage supported account actions.", "/app/admin/users"],
  ["Gallery", "Search and browse images and videos across both GPU sources.", "/app/admin/gallery"],
  ["GPU / Services", "Identity-pinned GPU maintenance and service health diagnostics.", "/app/admin/health"],
  ["Performance", "Storage, thumbnail cache, runtime and advanced diagnostics.", "/app/admin/performance"],
  ["Billing & Usage", "Local credit records, spending warnings and official OpenAI cost sync.", "/app/admin/openai-billing"],
];
export default function AdminRootPage() {
  return <AdminShell title="Admin Panel" description="Application control center"><AdminSummary /><nav aria-label="Admin sections" className={styles.grid}>{sections.map(([title, description, route]) => <article className={styles.card} key={route}><h2>{title}</h2><p className={styles.muted}>{description}</p><a className={styles.button} href={route} aria-label={`Open ${title}`}>Open</a></article>)}</nav></AdminShell>;
}
