import { Badge, Card } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatIST } from "../../enquiries/labels";

const MESSAGE_KIND_LABEL: Record<string, string> = {
  note: "Site note",
  other: "Note",
  delay: "Delay",
  site_issue: "Site issue",
  equipment_problem: "Equipment issue",
  leave: "Leave",
  acknowledgement: "Acknowledged",
  completion: "Completed",
};

export async function SiteNotes({ jobId }: { jobId: string }) {
  const { supabase } = await requireStaff();

  const { data: notes } = await supabase
    .from("technician_messages")
    .select("id, kind, body, received_at, people(full_name)")
    .eq("job_id", jobId)
    .order("received_at", { ascending: false });

  const list = (notes ?? []).filter((n) => Boolean(n.body && n.body.trim()));

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Notes from site</h2>
        <Badge>{list.length}</Badge>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-ink-3">
          No notes or comments from the technician for this job yet.
        </p>
      ) : (
        <ul className="divide-y divide-line-2 text-sm">
          {list.map((n) => {
            const personRow = n.people as unknown as { full_name?: string } | null;
            return (
              <li key={n.id} className="py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">
                    {personRow?.full_name ?? "Technician"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {n.kind !== "note" && n.kind !== "other" && (
                      <Badge>{MESSAGE_KIND_LABEL[n.kind] ?? n.kind}</Badge>
                    )}
                    <span className="text-xs text-ink-3">{formatIST(n.received_at)}</span>
                  </div>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-ink-2">{n.body}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
