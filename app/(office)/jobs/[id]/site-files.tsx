import { Badge, Card } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatIST } from "../../enquiries/labels";

const KIND_LABEL: Record<string, string> = {
  site_photo: "Site photo",
  site_file: "Site file",
  defect_photo: "Defect photo",
  drawing: "Drawing",
  supporting_document: "Document",
  purchase_order: "PO file",
  other: "File",
};

export async function SiteFiles({ jobId }: { jobId: string }) {
  const { supabase } = await requireStaff();

  const { data: attachments } = await supabase
    .from("attachments")
    .select("id, kind, caption, storage_path, uploaded_at, people(full_name)")
    .eq("job_id", jobId)
    .order("uploaded_at", { ascending: false });

  const list = attachments ?? [];

  const withUrls = await Promise.all(
    list.map(async (att) => {
      const rawName = att.storage_path.split("/").pop() || att.storage_path;
      const cleanFileName = rawName.replace(/^\d+-/, "");
      const [openRes, downloadRes] = await Promise.all([
        supabase.storage.from("documents").createSignedUrl(att.storage_path, 3600),
        supabase.storage
          .from("documents")
          .createSignedUrl(att.storage_path, 3600, { download: cleanFileName }),
      ]);
      const personRow = att.people as unknown as { full_name?: string } | null;
      return {
        ...att,
        fileName: cleanFileName,
        uploaderName: personRow?.full_name ?? null,
        openUrl: openRes.data?.signedUrl ?? null,
        downloadUrl: downloadRes.data?.signedUrl ?? openRes.data?.signedUrl ?? null,
      };
    }),
  );

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Files from site</h2>
        <Badge>{withUrls.length}</Badge>
      </div>
      {withUrls.length === 0 ? (
        <p className="text-[15px] text-ink-3">
          No photos or files uploaded from site yet. Technicians can upload photos, PDFs and documents directly from the phone app.
        </p>
      ) : (
        <ul className="divide-y divide-line-2 text-[15px]">
          {withUrls.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-medium text-ink">
                    {f.caption || f.fileName}
                  </span>
                  <Badge>{KIND_LABEL[f.kind] ?? f.kind}</Badge>
                </div>
                <p className="mt-0.5 truncate text-[13px] text-ink-3">
                  {[
                    f.caption ? f.fileName : null,
                    f.uploaderName ? `by ${f.uploaderName}` : null,
                    f.uploaded_at ? formatIST(f.uploaded_at) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-[13px] font-medium">
                {f.openUrl ? (
                  <a
                    href={f.openUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink underline hover:text-ink-2"
                  >
                    Open
                  </a>
                ) : (
                  <span className="text-ink-3">{f.fileName}</span>
                )}
                {f.downloadUrl && (
                  <a
                    href={f.downloadUrl}
                    download={f.fileName}
                    className="text-ink underline hover:text-ink-2"
                  >
                    Download
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
