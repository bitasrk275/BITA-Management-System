import Link from "next/link";
import {
  Badge,
  ButtonLink,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Status,
} from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { todayIST } from "@/lib/dates";
import { Constants, type Enums } from "@/lib/db/types";
import { currentFinancialYear } from "@/lib/modules/finance/schema";
import { isJobReadyToClose } from "./closure";
import { JOB_STATUS_LABEL, METHOD_LABEL } from "./labels";

export const metadata = { title: "Jobs – BITA" };

function buildFyOptions(asOfDate: string): string[] {
  const cur = currentFinancialYear(asOfDate);
  const startYear = Number(cur.slice(0, 4)) || 2026;
  const options: string[] = [];
  for (let y = startYear + 1; y >= startYear - 3; y--) {
    const endShort = String((y + 1) % 100).padStart(2, "0");
    options.push(`${y}-${endShort}`);
  }
  return options;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    fy?: string;
    month?: string;
    customer_id?: string;
  }>;
}) {
  const { q, status, fy, month, customer_id: customerId } = await searchParams;
  const { supabase } = await requireStaff();

  const asOf = todayIST();
  const defaultFy = currentFinancialYear(asOf);
  const fyOptions = buildFyOptions(asOf);
  const selectedFy = fy ?? defaultFy;

  let query = supabase
    .from("jobs")
    .select(
      "id, job_no, customer_id, status, scope, site, test_methods, po_number, created_at, customers(id, name), reports(status, sent_at), invoices(kind, balance)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (
    status &&
    (Constants.public.Enums.job_status as readonly string[]).includes(status)
  ) {
    query = query.eq("status", status as Enums<"job_status">);
  }
  if (customerId) {
    query = query.eq("customer_id", customerId);
  }
  // Commas and brackets have a meaning in the filter syntax, so they are dropped from the search text.
  const term = q?.replace(/[,()%*]/g, " ").trim();
  if (term) {
    query = query.or(
      `job_no.ilike.%${term}%,po_number.ilike.%${term}%,scope.ilike.%${term}%`,
    );
  }

  const [{ data: jobs, error }, { data: customers }] = await Promise.all([
    query,
    supabase.from("customers").select("id, name").order("name", { ascending: true }),
  ]);

  return (
    <>
      <PageHeader
        title="Jobs"
        action={<ButtonLink href="/jobs/new">New job</ButtonLink>}
      />

      {/* Export Jobs Register (R17) */}
      <Card className="mb-4">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              Export jobs register (R17 notebook format)
            </h2>
            <p className="text-xs text-ink-3">
              Columns: Date of testing · Person who tested · Customer · Report no(s) · Component / Serial no · Details of testing · Invoice generated · Invoice no(s) · Remarks
            </p>
          </div>
        </div>
        <form
          method="get"
          action="/jobs/export"
          className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto_auto]"
        >
          <Field label="Financial year">
            <Select name="fy" defaultValue={selectedFy}>
              <option value="all">All financial years</option>
              {fyOptions.map((opt) => (
                <option key={opt} value={opt}>
                  FY {opt}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Month (optional)">
            <Input type="month" name="month" defaultValue={month ?? ""} />
          </Field>
          <Field label="Customer">
            <Select name="customer_id" defaultValue={customerId ?? ""}>
              <option value="">All customers</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <button
              type="submit"
              name="format"
              value="csv"
              className="w-full rounded-lg border border-line bg-white px-3.5 py-2 text-[13.5px] font-medium text-ink hover:bg-side"
            >
              Export register (CSV)
            </button>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              name="format"
              value="xls"
              className="w-full rounded-lg bg-ink px-3.5 py-2 text-[13.5px] font-medium text-white hover:bg-ink-2"
            >
              Export register (XLS)
            </button>
          </div>
        </form>
      </Card>

      <form className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Input
          name="q"
          placeholder="Search Job ID, PO number or scope"
          defaultValue={q}
        />
        <Select name="status" defaultValue={status ?? ""}>
          <option value="">All statuses</option>
          {Constants.public.Enums.job_status.map((s) => (
            <option key={s} value={s}>
              {JOB_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <button className="rounded-md border border-line px-4 py-2 text-sm font-semibold hover:bg-side">
          Filter
        </button>
      </form>
      {error && <p className="text-sm text-ink">{error.message}</p>}
      <ul className="divide-y divide-line rounded-xl border border-line bg-white">
        {jobs?.map((j) => {
          const readyToClose = isJobReadyToClose({
            status: j.status,
            reports: j.reports,
            invoices: j.invoices,
          });
          return (
            <li key={j.id}>
              <Link
                href={`/jobs/${j.id}`}
                className="block px-4 py-3 hover:bg-side"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">
                    {j.job_no}
                  </span>
                  <Badge>{JOB_STATUS_LABEL[j.status]}</Badge>
                  {readyToClose && <Status tone="ok">Ready to close</Status>}
                  {j.test_methods.map((m) => (
                    <Badge key={m}>{METHOD_LABEL[m]}</Badge>
                  ))}
                </div>
                <div className="mt-1 text-sm">{j.customers?.name}</div>
                <div className="text-xs text-ink-3">
                  {[
                    j.scope,
                    j.site,
                    j.po_number ? `PO ${j.po_number}` : "No PO yet",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </Link>
            </li>
          );
        })}
        {jobs?.length === 0 && (
          <li className="px-4 py-6 text-sm text-ink-3">No jobs found.</li>
        )}
      </ul>
    </>
  );
}
