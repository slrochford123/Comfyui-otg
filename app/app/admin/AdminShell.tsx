import type { ReactNode } from "react";
import styles from "./Admin.module.css";
export { default as adminStyles } from "./Admin.module.css";
export default function AdminShell({ title, description, children, actions }: { title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return <main className={styles.shell}><a className={styles.button} href={title === "Admin Panel" ? "/app" : "/app/admin"}>← {title === "Admin Panel" ? "Back to App" : "Admin Panel"}</a><header className={styles.header}><div><h1>{title}</h1>{description ? <p className={styles.muted}>{description}</p> : null}</div>{actions}</header>{children}</main>;
}
export function AdminBadge({ status }: { status: string }) {
  const color = status === "HEALTHY" ? "var(--color-success)" : status === "DOWN" ? "var(--color-error)" : ["DEGRADED", "NOT CONFIGURED"].includes(status) ? "var(--color-warning)" : "var(--color-text-muted)";
  return <span className={styles.badge} style={{ color }}>{status}</span>;
}
