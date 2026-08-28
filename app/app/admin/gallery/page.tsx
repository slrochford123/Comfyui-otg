import AdminGallerySourcesPanel from "../../components/AdminGallerySourcesPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminFullGalleryPage() {
  return (
    <main className="min-h-screen bg-[#03050b] p-3 text-white sm:p-6">
      <div className="mx-auto max-w-[1600px]">
        <AdminGallerySourcesPanel />
      </div>
    </main>
  );
}
