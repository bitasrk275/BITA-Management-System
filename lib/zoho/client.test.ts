import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearZohoTokenCache,
  createEstimate,
  createInvoice,
  getInvoice,
  getZohoAccessToken,
  listInvoicesModifiedSince,
  syncInvoices,
  upsertContact,
  ZOHO_INDIA_ACCOUNTS_URL,
  ZOHO_INDIA_BOOKS_BASE_URL,
  type ZohoConfig,
} from "./index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("lib/zoho – Zoho Books India API client & sync (T28)", () => {
  beforeEach(() => {
    clearZohoTokenCache();
  });

  function makeMockFetch(
    handler: (url: string, init?: RequestInit) => Response | Promise<Response>
  ): { cfg: ZohoConfig; calls: { url: string; init?: RequestInit }[] } {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === ZOHO_INDIA_ACCOUNTS_URL) {
        return jsonResponse({ access_token: "fake-india-access-token", expires_in: 3600 });
      }
      return handler(url, init);
    }) as unknown as typeof fetch;

    return {
      cfg: {
        clientId: "FAKE_CLIENT_ID",
        clientSecret: "FAKE_CLIENT_SECRET",
        refreshToken: "FAKE_REFRESH_TOKEN",
        organizationId: "60000000001",
        fetchImpl,
      },
      calls,
    };
  }

  it("exchanges refresh token against accounts.zoho.in and caches the access token", async () => {
    const { cfg, calls } = makeMockFetch(() => jsonResponse({}));

    const t1 = await getZohoAccessToken(cfg);
    const t2 = await getZohoAccessToken(cfg);

    expect(t1).toBe("fake-india-access-token");
    expect(t2).toBe("fake-india-access-token");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://accounts.zoho.in/oauth/v2/token");
    expect(String(calls[0]!.init?.body)).toContain("grant_type=refresh_token");
  });

  it("upserts a customer contact on www.zohoapis.in/books/v3", async () => {
    const { cfg, calls } = makeMockFetch((url, init) => {
      if (init?.method === "GET" && url.includes("/contacts")) {
        return jsonResponse({ contacts: [] });
      }
      if (init?.method === "POST" && url.includes("/contacts")) {
        const parsed = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          contact: {
            contact_id: "zoho-cust-901",
            contact_name: parsed.contact_name,
            gst_no: parsed.gst_no,
          },
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await upsertContact(
      {
        name: "Test Turbines Pvt Ltd",
        gstin: "29AAACT0001A1Z5",
        payment_terms_days: 30,
        contacts: [{ name: "R. Demo Contact", email: "qa@test-turbines.test" }],
      },
      cfg
    );

    expect(result).toEqual({
      zoho_contact_id: "zoho-cust-901",
      contact_name: "Test Turbines Pvt Ltd",
      gst_no: "29AAACT0001A1Z5",
    });
    expect(calls.some((c) => c.url.startsWith(`${ZOHO_INDIA_BOOKS_BASE_URL}/contacts`))).toBe(true);
  });

  it("creates a proforma estimate carrying the Job ID and never sends local GST fields (Rules 4 & 5)", async () => {
    let sentBody: Record<string, unknown> = {};
    const { cfg } = makeMockFetch((_url, init) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        estimate: {
          estimate_id: "zoho-est-101",
          estimate_number: "PI-26-27/0501",
          date: "2026-11-06",
          total: 23600,
          status: "sent",
          reference_number: sentBody.reference_number,
        },
      });
    });

    const est = await createEstimate(
      {
        id: "77000000-0000-4000-8000-000000000001",
        job_no: "BITA/26-27/0101",
        zoho_contact_id: "zoho-cust-901",
        po_number: "PO-FAKE-01",
      },
      [{ description: "UT inspection of turbine shaft", rate: 20000, quantity: 1 }],
      cfg
    );

    expect(sentBody.reference_number).toBe("BITA/26-27/0101");
    expect(sentBody).not.toHaveProperty("tax_total");
    expect(sentBody).not.toHaveProperty("gst_amount");
    expect(est.zoho_id).toBe("zoho-est-101");
    expect(est.kind).toBe("proforma");
    expect(est.reference_number).toBe("BITA/26-27/0101");
    expect(est.total).toBe(23600);
  });

  it("refuses to create a duplicate GST invoice when a job already has one (Rule 5)", async () => {
    const { cfg, calls } = makeMockFetch(() => jsonResponse({}));

    await expect(
      createInvoice(
        {
          id: "77000000-0000-4000-8000-000000000008",
          job_no: "BITA/26-27/0108",
          zoho_contact_id: "zoho-cust-901",
          zoho_invoice_id: "zoho-inv-existing",
        },
        [{ description: "UT inspection", rate: 25000 }],
        cfg
      )
    ).rejects.toThrow("already has a Zoho GST invoice");

    // No network request should have been made
    expect(calls).toHaveLength(0);
  });

  it("creates a GST invoice carrying the Job ID and fetches modified invoices", async () => {
    let createdPayload: Record<string, unknown> = {};
    const { cfg } = makeMockFetch((url, init) => {
      if (init?.method === "POST" && url.includes("/invoices")) {
        createdPayload = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          invoice: {
            invoice_id: "zoho-inv-801",
            invoice_number: "INV-26-27/0801",
            date: "2026-11-06",
            due_date: "2026-12-06",
            total: 29500,
            balance: 29500,
            status: "sent",
            reference_number: createdPayload.reference_number,
          },
        });
      }
      if (init?.method === "GET" && url.includes("/invoices/zoho-inv-801")) {
        return jsonResponse({
          invoice: {
            invoice_id: "zoho-inv-801",
            invoice_number: "INV-26-27/0801",
            date: "2026-11-06",
            due_date: "2026-12-06",
            total: 29500,
            balance: 0,
            status: "paid",
            reference_number: "BITA/26-27/0107",
          },
        });
      }
      return jsonResponse({
        invoices: [
          {
            invoice_id: "zoho-inv-801",
            invoice_number: "INV-26-27/0801",
            date: "2026-11-06",
            due_date: "2026-12-06",
            total: 29500,
            balance: 0,
            status: "paid",
            reference_number: "BITA/26-27/0107",
          },
        ],
      });
    });

    const created = await createInvoice(
      {
        id: "77000000-0000-4000-8000-000000000007",
        job_no: "BITA/26-27/0107",
        zoho_contact_id: "zoho-cust-901",
      },
      [{ description: "UT inspection", rate: 25000 }],
      { ...cfg, hasExistingTaxInvoice: async () => false }
    );

    expect(createdPayload.reference_number).toBe("BITA/26-27/0107");
    expect(created.zoho_id).toBe("zoho-inv-801");

    const fetched = await getInvoice("zoho-inv-801", cfg);
    expect(fetched.balance).toBe(0);
    expect(fetched.status).toBe("paid");

    const modified = await listInvoicesModifiedSince("2026-11-01T00:00:00+0530", cfg);
    expect(modified).toHaveLength(1);
    expect(modified[0]!.reference_number).toBe("BITA/26-27/0107");
  });

  it("mirrors modified Zoho invoices into public.invoices via syncInvoices", async () => {
    const upsertedRows: Record<string, unknown>[] = [];
    const updatedJobIds: string[] = [];

    const mockSupabase = {
      from: (table: string) => {
        if (table === "jobs") {
          return {
            select: () => ({
              in: async () => ({
                data: [
                  {
                    id: "77000000-0000-4000-8000-000000000007",
                    job_no: "BITA/26-27/0107",
                    status: "report_sent",
                  },
                ],
                error: null,
              }),
            }),
            update: () => ({
              eq: async (_col: string, val: string) => {
                updatedJobIds.push(val);
                return { error: null };
              },
            }),
          };
        }
        if (table === "invoices") {
          return {
            upsert: async (row: Record<string, unknown>) => {
              upsertedRows.push(row);
              return { error: null };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    const res = await syncInvoices({
      supabase: mockSupabase as never,
      prefetchedInvoices: [
        {
          zoho_id: "zoho-inv-801",
          kind: "tax_invoice",
          number: "INV-26-27/0801",
          invoice_date: "2026-11-06",
          due_date: "2026-12-06",
          total: 29500,
          balance: 10000,
          status: "partially_paid",
          reference_number: "BITA/26-27/0107",
        },
        {
          zoho_id: "zoho-inv-unmatched",
          kind: "tax_invoice",
          number: "INV-26-27/0999",
          invoice_date: "2026-11-06",
          due_date: "2026-12-06",
          total: 11800,
          balance: 11800,
          status: "sent",
          reference_number: "BITA/26-27/9999",
        },
      ],
    });

    expect(res).toEqual({
      fetched: 2,
      synced: 1,
      skippedUnmatched: ["zoho-inv-unmatched"],
    });
    expect(upsertedRows).toHaveLength(1);
    expect(upsertedRows[0]).toMatchObject({
      job_id: "77000000-0000-4000-8000-000000000007",
      kind: "tax_invoice",
      zoho_id: "zoho-inv-801",
      number: "INV-26-27/0801",
      total: 29500,
      balance: 10000,
      status: "partly_paid",
    });
    expect(updatedJobIds).toEqual(["77000000-0000-4000-8000-000000000007"]);
  });
});
