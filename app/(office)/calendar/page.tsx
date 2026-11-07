import { ErrorNote, PageHeader, SavedNote, Stats } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import type { Enums } from "@/lib/db/types";
import { getMonthRange, getWeekRange, todayIST } from "@/lib/modules/calendar/schema";
import { getCalendarView } from "@/lib/modules/calendar/service";
import { CalendarInteractiveView } from "./calendar-view";

export const dynamic = "force-dynamic";

export default async function CalendarPage(props: {
  searchParams: Promise<{
    date?: string;
    view?: "week" | "month";
    jobId?: string;
    techId?: string;
    error?: string;
    saved?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const { supabase } = await requireStaff();

  const currentDate = searchParams.date || todayIST();
  const viewMode = searchParams.view === "month" ? "month" : "week";

  let startDate: string;
  let endDate: string;

  if (viewMode === "month") {
    const [yStr, mStr] = currentDate.split("-");
    const y = parseInt(yStr || "2026", 10);
    const m = parseInt(mStr || "11", 10);
    const range = getMonthRange(y, m);
    startDate = range.startDate;
    endDate = range.endDate;
  } else {
    const range = getWeekRange(currentDate);
    startDate = range.startDate;
    endDate = range.endDate;
  }

  // 1. Fetch Calendar Grid Data
  const calendarData = await getCalendarView(supabase, {
    startDate,
    endDate,
    technicianId: searchParams.techId || null,
  });

  // 2. Fetch Active Jobs for Assign Modal
  const { data: jobRows } = await supabase
    .from("jobs")
    .select(`
      id,
      job_no,
      test_methods,
      site,
      status,
      customer:customers!jobs_customer_id_fkey(name)
    `)
    .neq("status", "closed")
    .order("created_at", { ascending: false })
    .limit(50);

  const jobs = (jobRows ?? []).map((j) => ({
    id: j.id,
    job_no: j.job_no,
    customerName: (j.customer as unknown as { name?: string } | null)?.name ?? "Customer",
    site: j.site,
    status: j.status,
    testMethods: (j.test_methods ?? []) as Enums<"test_method">[],
  }));

  // 3. Fetch Equipment for Booking
  const { data: eqRows } = await supabase
    .from("equipment")
    .select(`
      id,
      make,
      model,
      serial_no,
      status,
      calibration_due,
      equipment_types(name)
    `)
    .is("deleted_at", null)
    .eq("active", true)
    .order("make", { ascending: true });

  const equipmentList = (eqRows ?? []).map((eq) => ({
    id: eq.id,
    make: eq.make,
    model: eq.model,
    serial_no: eq.serial_no,
    typeName: (eq.equipment_types as unknown as { name?: string } | null)?.name ?? null,
    calibration_due: eq.calibration_due,
    status: eq.status,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule & Calendar"
        subtitle="Manage technician assignments, multi-day schedules, equipment bookings, and leaves."
      />

      <ErrorNote message={searchParams.error} />
      {searchParams.saved && <SavedNote />}

      {/* Overview Stats */}
      <Stats
        items={[
          { label: "Technicians", value: calendarData.totalTechnicians },
          { label: "Scheduled Jobs", value: calendarData.totalAssignments },
          { label: "Leave Days", value: calendarData.totalLeaves },
        ]}
      />

      {/* Main Interactive Grid */}
      <CalendarInteractiveView
        data={calendarData}
        currentDate={currentDate}
        viewMode={viewMode}
        jobs={jobs}
        equipmentList={equipmentList}
        selectedJobId={searchParams.jobId || null}
        selectedTechId={searchParams.techId || null}
      />
    </div>
  );
}
