import { describe, expect, it } from "vitest";
import {
  formatExecutiveDigestMessage,
  normalizeTelegramConfig,
  normalizeTelegramLinksState,
  type ExecutiveSnapshot,
} from "./service";

describe("Telegram Executive Bot Service (lib/modules/telegram/service.ts)", () => {
  it("normalizes telegram config with safe defaults", () => {
    const cfg = normalizeTelegramConfig({
      bot_token: "123:abc",
      bot_username: "bita_bot",
      enabled: true,
      notify_on_report: false,
    });
    expect(cfg.bot_token).toBe("123:abc");
    expect(cfg.bot_username).toBe("bita_bot");
    expect(cfg.enabled).toBe(true);
    expect(cfg.notify_on_report).toBe(false);
    expect(cfg.notify_on_invoice).toBe(true);
    expect(cfg.notify_on_payment).toBe(true);
    expect(cfg.notify_daily_digest).toBe(true);
  });

  it("normalizes linked chats and pending 6-digit codes", () => {
    const state = normalizeTelegramLinksState({
      chats: [
        {
          chat_id: "998877",
          person_id: "p-1",
          person_name: "Demo Director",
          username: "demodir",
          linked_at: "2026-11-09T06:00:00Z",
          active: true,
        },
      ],
      pending_codes: [
        {
          code: "654321",
          person_id: "p-2",
          person_name: "Demo Office",
          expires_at: "2026-11-09T06:15:00Z",
        },
      ],
    });
    expect(state.chats).toHaveLength(1);
    expect(state.chats[0].chat_id).toBe("998877");
    expect(state.pending_codes).toHaveLength(1);
    expect(state.pending_codes[0].code).toBe("654321");
  });

  it("formats executive digest message with overdue invoices, unbilled jobs, and calibration alerts", () => {
    const snap: ExecutiveSnapshot = {
      today: "2026-11-09",
      activeJobsCount: 7,
      jobsByStatus: { scheduled: 3, inspection_done: 2, invoiced: 2 },
      recentJobs: [],
      unbilledDoneJobs: [
        { job_no: "BITA/26-27/0010", customer_name: "Sample Forgings Ltd", status: "inspection_done" },
      ],
      openInvoicesCount: 3,
      openReceivablesTotal: 145000,
      overdueInvoices: [
        {
          invoice_no: "5387",
          customer_name: "Demo Wind Energy Pvt Ltd",
          balance: 81420,
          due_date: "2026-11-01",
        },
      ],
      pendingReports: [{ job_no: "BITA/26-27/0011", method: "UT", submitted_at: "2026-11-08" }],
      calibrationAlerts: [
        { code: "UT-01", name: "Digital Ultrasonic Flaw Detector", due_date: "2026-11-05", expired: true },
      ],
      todayAssignments: [
        { job_no: "BITA/26-27/0012", technician_name: "Ramesh K", customer_name: "Demo Gears Ltd" },
      ],
    };

    const msg = formatExecutiveDigestMessage(snap);
    expect(msg).toContain("BITA Executive Dashboard (2026-11-09)");
    expect(msg).toContain("Active Jobs:* 7 (1 completed & unbilled)");
    expect(msg).toContain("₹1,45,000");
    expect(msg).toContain("5387");
    expect(msg).toContain("BITA/26-27/0010");
    expect(msg).toContain("UT-01");
  });
});
