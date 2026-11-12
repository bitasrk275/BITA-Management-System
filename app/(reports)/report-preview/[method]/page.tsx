import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, Mono, PageHeader, SectionTitle, Status } from "@/components/ui";
import { isStaff, requireStaff } from "@/lib/auth";
import { ReportTemplate } from "@/templates/reports/report";
import { previewDocument } from "@/templates/reports/preview-data";
import {
  buildSeedTemplates,
  getOrSeedReportTemplates,
  type TemplateFieldConfig,
} from "@/lib/modules/settings/templates";
import { fakeSealSvgDataUrl, fakeSignatureSvgDataUrl } from "../../../../lib/reports/review";
import { PrintButton } from "./print-button";
import "@/templates/reports/report.css";

export const metadata = { title: "Report format preview – BITA" };

export default async function ReportPreview({
  params,
  searchParams,
}: {
  params: Promise<{ method: string }>;
  searchParams?: Promise<{ approved?: string }>;
}) {
  const { supabase, person } = await requireStaff();
  if (!person || !isStaff(person.roles)) notFound();

  const rawMethod = (await params).method.trim();
  const canonicalMethod = rawMethod.toUpperCase() === "MT" ? "MPT" : rawMethod.toUpperCase();

  // Paper preview is strictly available for UT, MPT (or MT), and DPT
  if (canonicalMethod !== "UT" && canonicalMethod !== "MPT" && canonicalMethod !== "DPT") {
    notFound();
  }

  let templates = buildSeedTemplates();

  if (supabase && typeof (supabase as { from?: unknown })?.from === "function") {
    try {
      templates = await getOrSeedReportTemplates(supabase).catch(() => buildSeedTemplates());
    } catch {
      // Keep seeds
    }
  }

  const methodConfig: TemplateFieldConfig[] | undefined =
    templates[canonicalMethod] || templates[rawMethod];

  const resolvedSearch = searchParams ? await searchParams : undefined;
  const showApproved = resolvedSearch?.approved === "1";

  const doc = previewDocument(canonicalMethod as "UT" | "MPT" | "DPT");

  // Pre-fill readings for any configured fields
  if (methodConfig) {
    for (const f of methodConfig) {
      if (doc.readings && !(f.key in doc.readings)) {
        (doc.readings as Record<string, unknown>)[f.key] = `Sample ${f.label}`;
      }
    }
  }

  if (showApproved) {
    doc.approval = {
      approved: true,
      approvedAt: "2026-11-06T08:00:00Z",
      signatoryName: "FAKE TEST Reviewer (Level III)",
      signatoryQualification: "ASNT NDT Level III · UT / MT / PT (Fake Preview)",
      signatureUrl: fakeSignatureSvgDataUrl("FAKE TEST Reviewer"),
      sealUrl: fakeSealSvgDataUrl(),
    };
  }

  const activeTab = rawMethod.toUpperCase() === "MPT" ? "MT" : rawMethod.toUpperCase();

  return (
    <main className="report-preview-shell mx-auto max-w-5xl px-4 py-6">
      <div className="report-preview-controls mb-6 space-y-4">
        <PageHeader
          title="Report format preview"
          subtitle={
            <>
              Live preview rendered from Settings &gt; Report Templates (<Mono>{doc.reportNumber}</Mono>).
              Paper layout reproduces BITA&apos;s {activeTab} format.
            </>
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ButtonLink href="/settings" variant="secondary" size="sm">
                Edit in Settings
              </ButtonLink>
              <ButtonLink href="/review" variant="secondary" size="sm">
                Back to review
              </ButtonLink>
              <PrintButton />
            </div>
          }
        />

        <Card className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Report methods" className="flex flex-wrap items-center gap-2">
            {(["UT", "MT", "DPT"] as const).map((tab) => {
              const isActive = activeTab === tab;
              return (
                <ButtonLink
                  key={tab}
                  href={`/report-preview/${tab}${showApproved ? "?approved=1" : ""}`}
                  variant={isActive ? "primary" : "secondary"}
                  size="sm"
                >
                  {tab}
                </ButtonLink>
              );
            })}
          </nav>

          <div className="flex flex-wrap items-center gap-3">
            <Status tone={showApproved ? "ok" : "wait"}>
              {showApproved
                ? "Approved preview (fake signature & seal)"
                : "Draft preview (signature & seal withheld)"}
            </Status>
            <ButtonLink
              href={`/report-preview/${activeTab}${showApproved ? "" : "?approved=1"}`}
              variant="secondary"
              size="sm"
            >
              {showApproved ? "Show draft state" : "Preview approved state"}
            </ButtonLink>
          </div>
        </Card>
      </div>

      <div className="report-preview-paper mb-6">
        <ReportTemplate method={canonicalMethod as "UT" | "MPT" | "DPT"} document={doc} />
      </div>

      {methodConfig && methodConfig.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <SectionTitle>
              Configured Template Fields for {canonicalMethod} ({methodConfig.length})
            </SectionTitle>
            <Link
              href={`/settings?tab_method=${encodeURIComponent(canonicalMethod)}`}
              className="text-xs text-ink-2 hover:text-ink underline"
            >
              Configure fields in Settings →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-ink-3">
                  <th className="py-2 pr-3 w-8">#</th>
                  <th className="py-2 pr-3 font-medium">Field Key</th>
                  <th className="py-2 pr-3 font-medium">Label</th>
                  <th className="py-2 pr-3 font-medium">Kind</th>
                  <th className="py-2 pr-3 font-medium">Input</th>
                  <th className="py-2 pr-3 font-medium">Required</th>
                  <th className="py-2 font-medium">Dropdown Options</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {methodConfig.map((f, i) => (
                  <tr key={f.key} className="hover:bg-side">
                    <td className="py-2 pr-3 text-ink-3">{i + 1}</td>
                    <td className="py-2 pr-3 font-mono text-ink">{f.key}</td>
                    <td className="py-2 pr-3 text-ink font-medium">{f.label}</td>
                    <td className="py-2 pr-3">
                      <Badge>{f.kind}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-ink-2">{f.input}</td>
                    <td className="py-2 pr-3">
                      {f.required ? (
                        <span className="font-semibold text-bad">Yes</span>
                      ) : (
                        <span className="text-ink-3">No</span>
                      )}
                    </td>
                    <td className="py-2 text-ink-2 truncate max-w-xs">
                      {f.options && f.options.length > 0 ? f.options.join(", ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </main>
  );
}
