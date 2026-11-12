import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/types";
import {
  buildEnquiryPrefillFromEmail,
  extractStandardHint,
  formatStructuredEnquiryNotes,
  parsePastedEmail,
} from "./ai-assist";
import { parseEnquiryInput } from "./schema";

describe("G5 – Enquiry AI assist (parsePastedEmail, buildEnquiryPrefillFromEmail, parseEnquiryInput)", () => {
  it("parses sender name, email, phone, subject, and standard from a pasted customer email", () => {
    const rawEmail = [
      "From: R. Demo Buyer <buyer@demo-forgings.example.test>",
      "Subject: Urgent UT of 6 forged rotor shafts per ASTM A388",
      "",
      "Dear BITA Team,",
      "Please depute your Level II inspector tomorrow at our Peenya Unit 2 plant for Ultrasonic Testing of 6 forged rotor shafts as per ASTM A388.",
      "Regards,",
      "R. Demo Buyer",
      "+91 98450 11223",
    ].join("\n");

    const parsed = parsePastedEmail(rawEmail);
    expect(parsed.senderName).toBe("R. Demo Buyer");
    expect(parsed.senderEmail).toBe("buyer@demo-forgings.example.test");
    expect(parsed.senderPhone).toBe("9845011223");
    expect(parsed.subject).toBe("Urgent UT of 6 forged rotor shafts per ASTM A388");
    expect(extractStandardHint(rawEmail)).toBe("ASTM A388");
  });

  it("prefills customer match, requirement, standard, component, quantity, and site via extractEnquiry + matchCustomer without storing raw email", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              customer_hint: "Demo Forgings Pvt Ltd",
              contact_name: "R. Demo Buyer",
              component: "Forged rotor shafts",
              quantity: 6,
              test_methods: ["UT"],
              site: "Peenya Unit 2",
              urgency: "urgent",
              summary: "Ultrasonic testing of 6 forged rotor shafts at Peenya Unit 2.",
            }),
          },
        ],
      }),
    });

    const mockSupabase = {
      from(table: string) {
        return {
          select() {
            return {
              ilike(_col: string, val: string) {
                return {
                  order() {
                    return this;
                  },
                  limit() {
                    return {
                      async maybeSingle() {
                        if (
                          table === "customer_contacts" &&
                          val === "buyer@demo-forgings.example.test"
                        ) {
                          return {
                            data: { customer_id: "cust-fake-101" },
                            error: null,
                          };
                        }
                        return { data: null, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient<Database>;

    const rawSecretEmail = [
      "From: R. Demo Buyer <buyer@demo-forgings.example.test>",
      "Subject: Urgent UT of 6 forged rotor shafts per ASTM A388",
      "",
      "CONFIDENTIAL RAW EMAIL LINE THAT MUST NOT BE AUTO-SAVED",
      "Please carry out UT on 6 forged rotor shafts as per ASTM A388 at Peenya Unit 2.",
    ].join("\n");

    const res = await buildEnquiryPrefillFromEmail(
      mockSupabase,
      rawSecretEmail,
      {
        apiKey: "fake-anthropic-key",
        model: "claude-sonnet-5-5",
        fetchFn: mockFetch as unknown as typeof fetch,
      },
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.customer_id).toBe("cust-fake-101");
      expect(res.data.from_name).toBe("R. Demo Buyer");
      expect(res.data.from_address).toBe("buyer@demo-forgings.example.test");
      expect(res.data.requirement).toBe(
        "Ultrasonic testing of 6 forged rotor shafts at Peenya Unit 2.",
      );
      expect(res.data.standard).toBe("ASTM A388");
      expect(res.data.component).toBe("Forged rotor shafts");
      expect(res.data.quantity).toBe(6);
      expect(res.data.site).toBe("Peenya Unit 2");
      expect(res.data.test_methods).toEqual(["UT"]);
      // Raw email text is never placed in notes automatically
      expect(res.data.notes).not.toContain(
        "CONFIDENTIAL RAW EMAIL LINE THAT MUST NOT BE AUTO-SAVED",
      );
      expect(res.data.notes).toContain("Standard: ASTM A388");
      expect(res.data.notes).toContain("Component: Forged rotor shafts");
    }
  });

  it("stores structured fields in extracted JSON and formatted notes without raw_email", () => {
    const parsed = parseEnquiryInput({
      source: "email",
      customer_id: "cust-fake-101",
      from_name: "R. Demo Buyer",
      from_address: "buyer@demo-forgings.example.test",
      subject: "UT of 6 forged rotor shafts",
      requirement: "Ultrasonic testing of 6 forged rotor shafts",
      standard: "ASTM A388",
      component: "Forged rotor shafts",
      quantity: "6",
      site: "Peenya Unit 2",
      test_methods: "UT",
      body: formatStructuredEnquiryNotes({
        requirement: "Ultrasonic testing of 6 forged rotor shafts",
        test_methods: ["UT"],
        standard: "ASTM A388",
        component: "Forged rotor shafts",
        quantity: 6,
        site: "Peenya Unit 2",
      }),
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.extracted).toEqual({
        summary: "Ultrasonic testing of 6 forged rotor shafts",
        standard: "ASTM A388",
        component: "Forged rotor shafts",
        quantity: 6,
        site: "Peenya Unit 2",
        test_methods: ["UT"],
      });
      expect(parsed.value.body).toContain("Standard: ASTM A388");
    }
  });
});
