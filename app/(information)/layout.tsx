import type {ReactNode} from "react";
import styles from "./public-information.module.css";

export default function PublicInformationLayout({children}: {children: ReactNode}) {
  return <div className={styles.page}>
    <a className={styles.skip} href="#information">Skip to content</a>
    <header className={styles.header}>
      <a className={styles.brand} href="/about"><img src="/Brand/slr-icon.png" width="48" height="48" alt=""/>SLR Studios</a>
      <a className={styles.open} href="/app">Open studio</a>
    </header>
    <main id="information" className={styles.content}>{children}</main>
    <footer className={styles.footer}>
      <nav aria-label="App information"><a href="/about">About SLR Studios</a><a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a></nav>
      <p>Questions or data requests? <a href="mailto:slrochford123@gmail.com">slrochford123@gmail.com</a></p>
    </footer>
  </div>;
}
