import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Status } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatINR } from "../../../jobs/labels";
import { DEFAULT_QUOTATION_TERMS, formatDateIN, QUOTATION_STATUS_LABEL } from "../../labels";
import { PrintQuotationButton } from "./print-button";

// R8: Generate quotations on BITA letterhead in the style of A5.
// Signatures and seal are shown only once approved by management (R10, R27).
export default async function QuotationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireStaff();

  const { data: quotation } = await supabase.from("quotations").select("*").eq("id", id).maybeSingle();
  if (!quotation) notFound();

  const [customer, items, approver] = await Promise.all([
    supabase.from("customers").select("*").eq("id", quotation.customer_id).maybeSingle(),
    supabase.from("quotation_items").select("*").eq("quotation_id", id).order("position").order("id"),
    quotation.approved_by
      ? supabase.from("people").select("full_name, position, signature_path").eq("id", quotation.approved_by).maybeSingle()
      : null,
  ]);

  const isApproved = Boolean(quotation.approved_at && ["approved", "sent", "accepted"].includes(quotation.status));

  const [logoRes, sealRes, sigRes] = await Promise.all([
    supabase.storage.from("branding").createSignedUrl("logo.png", 600),
    isApproved ? supabase.storage.from("branding").createSignedUrl("seal.png", 600) : Promise.resolve({ data: null }),
    isApproved && approver?.data?.signature_path
      ? supabase.storage.from("branding").createSignedUrl(approver.data.signature_path, 600)
      : Promise.resolve({ data: null }),
  ]);

  const logoUrl = logoRes.data?.signedUrl ?? null;
  const sealUrl = sealRes.data?.signedUrl ?? null;
  const signatureUrl = sigRes.data?.signedUrl ?? null;

  const companyAddress = process.env.NEXT_PUBLIC_BITA_ADDRESS ?? "Vidyaranyapura, Bangalore";
  const companyContact = process.env.NEXT_PUBLIC_BITA_CONTACT ?? "Non-Destructive Testing & Inspection Services";
  const companyGstin = process.env.NEXT_PUBLIC_BITA_GSTIN ?? "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link href={`/quotations/${id}`} className="text-sm font-medium underline">
            ← Back to quotation
          </Link>
          <Badge>{QUOTATION_STATUS_LABEL[quotation.status]}</Badge>
          {!isApproved && (
            <Status tone="wait">Draft preview – management approval required before sending</Status>
          )}
        </div>
        <PrintQuotationButton />
      </div>

      <article className="mx-auto max-w-3xl rounded-lg border border-neutral-300 bg-white p-6 text-neutral-900 shadow-sm sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {/* BITA Letterhead */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-neutral-900 pb-4">
          <div className="flex items-start gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="BITA" className="h-14 w-auto object-contain" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border-2 border-neutral-900 font-black tracking-tighter text-neutral-900">
                BITA
              </div>
            )}
            <div>
              <h1 className="text-lg font-bold tracking-tight sm:text-xl">
                Bangalore Inspection &amp; Testing Agency
              </h1>
              <p className="text-xs text-neutral-700">{companyAddress}</p>
              <p className="text-xs text-neutral-600">{companyContact}</p>
            </div>
          </div>
          {companyGstin && (
            <div className="text-right text-xs">
              <div className="font-semibold text-neutral-500">GSTIN</div>
              <div className="font-mono font-bold">{companyGstin}</div>
            </div>
          )}
        </header>

        {/* Reference and Date row */}
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <div>
            <span className="font-semibold">Ref.: </span>
            <span className="font-mono font-semibold">{quotation.ref_no ?? "DRAFT"}</span>
          </div>
          <div>
            <span className="font-semibold">Date: </span>
            <span>{formatDateIN(quotation.quote_date)}</span>
          </div>
        </div>

        {/* Recipient */}
        <div className="mt-5 text-sm">
          <div className="font-semibold">To,</div>
          <div className="mt-0.5 font-bold">{customer.data?.name}</div>
          {customer.data?.billing_address && (
            <div className="whitespace-pre-wrap text-neutral-700">{customer.data.billing_address}</div>
          )}
          {customer.data?.gstin && <div className="mt-0.5 text-xs text-neutral-600">GSTIN: {customer.data.gstin}</div>}
        </div>

        {quotation.attention && (
          <div className="mt-4 text-sm">
            <span className="font-semibold">Kind Attn.: </span>
            <span>{quotation.attention}</span>
          </div>
        )}

        <div className="mt-4 text-sm">
          <p>Dear Sirs,</p>
          {quotation.subject && (
            <p className="mt-2 font-semibold underline">Sub: Quotation for {quotation.subject}</p>
          )}
          <p className="mt-2 text-neutral-800">
            With reference to your enquiry, we are pleased to quote our charges for carrying out the testing and inspection work as detailed below:
          </p>
        </div>

        {/* Priced Items Table */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse border border-neutral-400 text-left text-sm">
            <thead>
              <tr className="bg-neutral-100">
                <th className="w-12 border border-neutral-400 px-3 py-2 text-center font-semibold">Sl.</th>
                <th className="border border-neutral-400 px-3 py-2 font-semibold">Description / Scope of Work</th>
                <th className="w-36 border border-neutral-400 px-3 py-2 text-right font-semibold">Rate</th>
                <th className="w-28 border border-neutral-400 px-3 py-2 font-semibold">Basis</th>
                <th className="w-36 border border-neutral-400 px-3 py-2 text-right font-semibold">Minimum Charge</th>
              </tr>
            </thead>
            <tbody>
              {items.data?.map((it, idx) => (
                <tr key={it.id} className="align-top">
                  <td className="border border-neutral-400 px-3 py-2 text-center font-mono">{it.position || idx + 1}</td>
                  <td className="border border-neutral-400 px-3 py-2">
                    <div className="font-medium">{it.description}</div>
                    {it.notes && <div className="mt-0.5 text-xs text-neutral-600">{it.notes}</div>}
                  </td>
                  <td className="border border-neutral-400 px-3 py-2 text-right font-mono">{formatINR(it.rate)}</td>
                  <td className="border border-neutral-400 px-3 py-2 text-neutral-700">{it.basis ?? "–"}</td>
                  <td className="border border-neutral-400 px-3 py-2 text-right font-mono">
                    {it.minimum_charge ? formatINR(it.minimum_charge) : "–"}
                  </td>
                </tr>
              ))}
              {items.data?.length === 0 && (
                <tr>
                  <td colSpan={5} className="border border-neutral-400 px-3 py-4 text-center text-neutral-500">
                    No priced items entered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Terms & Conditions */}
        <div className="mt-5 text-sm">
          <div className="font-semibold">Terms &amp; Conditions:</div>
          <p className="mt-1 whitespace-pre-wrap text-neutral-800">{quotation.terms || DEFAULT_QUOTATION_TERMS}</p>
        </div>

        <p className="mt-5 text-sm text-neutral-800">
          We trust our offer is in line with your requirement and look forward to receiving your valued order.
        </p>

        {/* Sign-off block */}
        <footer className="mt-8 flex flex-wrap items-end justify-between gap-6 pt-4 text-sm">
          <div>
            <div>Thanking you,</div>
            <div className="mt-1 font-semibold">For Bangalore Inspection &amp; Testing Agency</div>
            {isApproved ? (
              <div className="mt-4 flex items-center gap-4">
                {signatureUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={signatureUrl} alt="Authorised signature" className="h-14 w-auto object-contain" />
                )}
                {sealUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sealUrl} alt="Company seal" className="h-16 w-auto object-contain" />
                )}
              </div>
            ) : (
              <div className="mt-6 text-xs italic text-neutral-500">
                (Awaiting management approval)
              </div>
            )}
            <div className="mt-3 font-semibold">{approver?.data?.full_name ?? "Authorised Signatory"}</div>
            {approver?.data?.position && <div className="text-xs text-neutral-600">{approver.data.position}</div>}
          </div>
        </footer>
      </article>
    </div>
  );
}
