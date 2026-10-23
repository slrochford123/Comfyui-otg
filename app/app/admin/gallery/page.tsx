import AdminGallerySourcesPanel from "../../components/AdminGallerySourcesPanel";
import AdminShell from "../AdminShell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminFullGalleryPage() {
  return (
    <AdminShell title="Gallery">
        <AdminGallerySourcesPanel />
    </AdminShell>
  );
}
