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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ report: string }> },
) {
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
    const { report } = await context.params;
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get("fy");
    const month = searchParams.get("month");
    const format = (searchParams.get("format") ?? "json").toLowerCase();

    const overview = await getFinanceOverview(auth.supabase, { fy, month });
    const normalized = report.toLowerCase();

    if (normalized === "ageing" || normalized === "receivables-ageing") {
      if (format === "csv") {
        const csv = receivablesAgeingToCsv(overview.ageing);
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="bita-receivables-ageing-${overview.as_of_date}.csv"`,
            "Cache-Control": "no-store",
          },
        });
      }
      return apiSuccess(overview.ageing);
    }

    if (normalized === "customer-revenue" || normalized === "customers") {
      if (format === "csv") {
        const csv = customerRevenueToCsv(overview.customer_revenue);
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="bita-customer-revenue-${overview.fy}.csv"`,
            "Cache-Control": "no-store",
          },
        });
      }
      return apiSuccess(overview.customer_revenue);
    }

    if (normalized === "monthly" || normalized === "monthly-income-expenses") {
      if (format === "csv") {
        const csv = monthlyIncomeVsExpensesToCsv(
          overview.monthly_income_vs_expenses,
        );
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="bita-monthly-income-vs-expenses-${overview.fy}.csv"`,
            "Cache-Control": "no-store",
          },
        });
      }
      return apiSuccess(overview.monthly_income_vs_expenses);
    }

    if (normalized === "payments" || normalized === "monthly-payments") {
      if (format === "csv") {
        const csv = monthlyPaymentsToCsv(overview.monthly_payments);
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="bita-payments-${overview.monthly_payments.month}.csv"`,
            "Cache-Control": "no-store",
          },
        });
      }
      return apiSuccess(overview.monthly_payments);
    }

    if (normalized === "proformas" || normalized === "unconverted-proformas") {
      if (format === "csv") {
        const csv = unconvertedProformasToCsv(overview.unconverted_proformas);
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="bita-unconverted-proformas-${overview.as_of_date}.csv"`,
            "Cache-Control": "no-store",
          },
        });
      }
      return apiSuccess(overview.unconverted_proformas);
    }

    return apiError(`Unknown finance report '${report}'.`, 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load finance report.";
    return apiError(msg, 500);
  }
}
