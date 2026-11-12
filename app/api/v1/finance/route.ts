import { NextResponse, type NextRequest } from "next/server";
import { apiError, apiSuccess, requireApiStaff } from "@/lib/api/v1";
import {
  customerRevenueToCsv,
  monthlyIncomeVsExpensesToCsv,
  monthlyPaymentsToCsv,
  receivablesAgeingToCsv,
  unconvertedProformasToCsv,
} from "@/lib/modules/finance/schema";
import { getFinanceOverview } from "@/lib/modules/finance/service";
import { hasPermissionForRoles } from "@/lib/modules/settings/service";

export async function GET(request: NextRequest) {
  const auth = await requireApiStaff();
  if (!auth.ok) return auth.response;

  const allowed = await hasPermissionForRoles(
    auth.supabase,
    auth.person.roles,
    "view_finance",
  );
  if (!allowed) {
    return apiError("Permission denied: view_finance is required.", 403);
  }

  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get("fy");
    const month = searchParams.get("month");
    const section = searchParams.get("section");
    const format = (searchParams.get("format") ?? "json").toLowerCase();

    const overview = await getFinanceOverview(auth.supabase, { fy, month });

    if (format === "csv") {
      let csv = "";
      let filename = `bita-finance-${overview.fy}.csv`;

      switch (section) {
        case "ageing":
          csv = receivablesAgeingToCsv(overview.ageing);
          filename = `bita-receivables-ageing-${overview.as_of_date}.csv`;
          break;
        case "customer-revenue":
        case "customers":
          csv = customerRevenueToCsv(overview.customer_revenue);
          filename = `bita-customer-revenue-${overview.fy}.csv`;
          break;
        case "monthly":
        case "monthly-income-expenses":
          csv = monthlyIncomeVsExpensesToCsv(overview.monthly_income_vs_expenses);
          filename = `bita-monthly-income-vs-expenses-${overview.fy}.csv`;
          break;
        case "payments":
          csv = monthlyPaymentsToCsv(overview.monthly_payments);
          filename = `bita-payments-${overview.monthly_payments.month}.csv`;
          break;
        case "proformas":
          csv = unconvertedProformasToCsv(overview.unconverted_proformas);
          filename = `bita-unconverted-proformas-${overview.as_of_date}.csv`;
          break;
        default:
          csv = receivablesAgeingToCsv(overview.ageing);
          filename = `bita-receivables-ageing-${overview.as_of_date}.csv`;
          break;
      }

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return apiSuccess(overview);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load finance reports.";
    return apiError(msg, 500);
  }
}
