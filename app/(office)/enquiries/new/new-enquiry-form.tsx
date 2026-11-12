"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  SecondaryButton,
  Select,
  Status,
  Textarea,
} from "@/components/ui";
import type { EnquiryAiPrefill } from "@/lib/modules/enquiries/ai-assist";
import { createEnquiry } from "../actions";

export function NewEnquiryForm({
  customers,
  aiEnabled,
}: {
  customers: { id: string; name: string }[];
  aiEnabled: boolean;
}) {
  const [rawEmail, setRawEmail] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMessage, setAiMessage] = useState<string | null>(null);

  const [source, setSource] = useState<"phone" | "whatsapp" | "email">("phone");
  const [customerId, setCustomerId] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [requirement, setRequirement] = useState("");
  const [standard, setStandard] = useState("");
  const [component, setComponent] = useState("");
  const [quantity, setQuantity] = useState("");
  const [site, setSite] = useState("");
  const [testMethods, setTestMethods] = useState("");
  const [body, setBody] = useState("");

  async function handleFillFromEmail() {
    const trimmed = rawEmail.trim();
    if (!trimmed) {
      setAiError("Paste the customer's email text first.");
      return;
    }

    setExtracting(true);
    setAiError(null);
    setAiMessage(null);

    try {
      const res = await fetch("/api/v1/enquiries/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw_email: trimmed }),
      });

      const payload = (await res.json()) as
        | { ok: true; data: EnquiryAiPrefill }
        | { ok: false; error?: { message?: string } };

      if (!res.ok || !payload.ok) {
        setAiError(
          (!payload.ok && payload.error?.message) ||
            "Could not extract enquiry details from the email.",
        );
        return;
      }

      const d = payload.data;
      setSource("email");
      if (d.customer_id) {
        setCustomerId(d.customer_id);
      }
      if (d.from_name) setFromName(d.from_name);
      if (d.from_address) setFromAddress(d.from_address);
      if (d.subject) setSubject(d.subject);
      if (d.requirement) setRequirement(d.requirement);
      if (d.standard) setStandard(d.standard);
      if (d.component) setComponent(d.component);
      if (d.quantity !== null && d.quantity !== undefined) {
        setQuantity(String(d.quantity));
      }
      if (d.site) setSite(d.site);
      if (d.test_methods && d.test_methods.length > 0) {
        setTestMethods(d.test_methods.join(", "));
      }
      if (d.notes) {
        setBody(d.notes);
      }

      const matchedCustomer = d.customer_id
        ? customers.find((c) => c.id === d.customer_id)
        : null;
      if (matchedCustomer) {
        setAiMessage(
          `Filled from email and matched customer "${matchedCustomer.name}". Review and edit before saving.`,
        );
      } else if (d.customer_hint) {
        setAiMessage(
          `Filled from email (customer hint: "${d.customer_hint}"). Select or add the customer and review before saving.`,
        );
      } else {
        setAiMessage("Filled from email. Review and edit before saving.");
      }
    } catch {
      setAiError("Network error while reading the email. Please try again.");
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="space-y-6">
      {aiEnabled && (
        <Card className="space-y-3">
          <Field
            label="Paste the customer's email"
            hint="Paste the customer's enquiry email below and click Fill from email. The raw email is not saved unless you copy it into the enquiry notes."
          >
            <Textarea
              rows={4}
              value={rawEmail}
              onChange={(e) => setRawEmail(e.target.value)}
              placeholder="From: Purchase <purchase@example.com>&#10;Subject: UT testing of 4 forged shafts as per ASTM A388&#10;&#10;Please arrange ultrasonic testing at our Peenya plant..."
            />
          </Field>
          {aiError && <ErrorNote message={aiError} />}
          {aiMessage && <Status tone="ok">{aiMessage}</Status>}
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton
              type="button"
              onClick={handleFillFromEmail}
              disabled={extracting}
            >
              {extracting ? "Reading email…" : "Fill from email"}
            </SecondaryButton>
            {rawEmail && (
              <SecondaryButton
                type="button"
                onClick={() => {
                  setRawEmail("");
                  setAiError(null);
                  setAiMessage(null);
                }}
              >
                Clear pasted email
              </SecondaryButton>
            )}
          </div>
        </Card>
      )}

      <form action={createEnquiry} className="space-y-4">
        <input type="hidden" name="test_methods" value={testMethods} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Received by">
            <Select
              name="source"
              value={source}
              onChange={(e) =>
                setSource(e.target.value as "phone" | "whatsapp" | "email")
              }
            >
              <option value="phone">Phone</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </Select>
          </Field>
          <Field label="Received on" hint="Leave empty for now">
            <Input name="received_at" type="datetime-local" />
          </Field>
        </div>

        <Field
          label="Customer"
          hint="Pick an existing customer if you know who it is"
        >
          <Select
            name="customer_id"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">Not linked yet</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-ink-3">
          New customer?{" "}
          <Link href="/customers/new" className="text-ink underline">
            Add the customer first
          </Link>
          .
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Caller / sender name">
            <Input
              name="from_name"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
            />
          </Field>
          <Field label="Phone number or email">
            <Input
              name="from_address"
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Subject" hint="e.g. UT of 4 forged shafts">
          <Input
            name="subject"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Requirement" hint="Summary of testing requested">
            <Input
              name="requirement"
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder="e.g. Ultrasonic testing of rotor shafts"
            />
          </Field>
          <Field label="Standard" hint="e.g. ASTM A388, ASME Sec V">
            <Input
              name="standard"
              value={standard}
              onChange={(e) => setStandard(e.target.value)}
              placeholder="e.g. ASTM A388"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Component">
            <Input
              name="component"
              value={component}
              onChange={(e) => setComponent(e.target.value)}
              placeholder="e.g. Forged rotor shafts"
            />
          </Field>
          <Field label="Quantity">
            <Input
              name="quantity"
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 4"
            />
          </Field>
          <Field label="Site">
            <Input
              name="site"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              placeholder="e.g. Peenya"
            />
          </Field>
        </div>

        <Field label="Details / enquiry notes">
          <Textarea
            name="body"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Component, quantity, test method, site, dates…"
          />
        </Field>
        <Button type="submit">Save enquiry</Button>
      </form>
    </div>
  );
}
