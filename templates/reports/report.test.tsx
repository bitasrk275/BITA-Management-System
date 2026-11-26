import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { METHOD_FIELDS, missingFields, type ReportMethod } from "../../lib/reports/fields";
import { REPORT_LAYOUTS } from "./layouts";
import { previewDocument } from "./preview-data";
import { DPTReport, MTReport, ReportTemplate, UTReport } from "./report";
import type { ReportDocument } from "./types";

vi.stubGlobal("React", React);

describe("paper report layouts", () => {
  it.each(["UT", "MPT", "DPT"] as const)("renders the %s source grid and required sections using only fake preview data", (method) => {
    const document = previewDocument(method);
    const html = renderToStaticMarkup(<ReportTemplate method={method} document={document} />);
    expect(missingFields(method, document.readings)).toEqual([]);
    expect(html).toContain(REPORT_LAYOUTS[method].title);
    expect(html.match(/<col style/g)?.length).toBe(REPORT_LAYOUTS[method].columns.length);
    for (const label of ["CLIENT", "PROJECT", "INSPECTION SITE/DATE", "Cert. No.", "Observations/Remarks"]) expect(html).toContain(label);
    expect(html).toContain("FORMAT PREVIEW ONLY");
    if (process.env.T8A_RENDER_DIR) {
      mkdirSync(process.env.T8A_RENDER_DIR, { recursive: true });
      writeFileSync(join(process.env.T8A_RENDER_DIR, `${method}.html`), `<!doctype html><html><head><meta charset="utf-8" /></head><body>${html}</body></html>`);
      const fakeAsset = (label: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="60"><rect width="180" height="60" fill="white" stroke="black"/><text x="8" y="35" font-size="14">${label}</text></svg>`)}`;
      document.approval = { approved: true, approvedAt: "2026-11-06T08:00:00Z", signatoryName: "FAKE TEST Reviewer", signatoryQualification: "Fake qualification", signatureUrl: fakeAsset("FAKE SIGNATURE"), sealUrl: fakeAsset("FAKE SEAL") };
      const approved = renderToStaticMarkup(<ReportTemplate method={method} document={document} />);
      writeFileSync(join(process.env.T8A_RENDER_DIR, `${method}-approved.html`), `<!doctype html><html><head><meta charset="utf-8" /></head><body>${approved}</body></html>`);
    }
  });

  it("uses the original method-specific cell spans without exceeding the column grid", () => {
    for (const layout of Object.values(REPORT_LAYOUTS)) {
      for (const spans of [layout.header, layout.client, layout.detail, layout.technicians, layout.items]) {
        expect(spans.reduce((sum: number, span) => sum + span, 0)).toBe(layout.columns.length);
      }
    }
  });

  it("never renders a signature, seal, signatory or their asset URLs for an unapproved document", () => {
    const document = previewDocument("UT");
    document.approval = { approved: false, signatureUrl: "https://example.test/hidden-signature", sealUrl: "https://example.test/hidden-seal", signatoryName: "Hidden signatory" } as ReportDocument["approval"];
    const html = renderToStaticMarkup(<UTReport document={document} />);
    expect(html).toContain("NOT APPROVED FOR ISSUE");
    expect(html).not.toContain("hidden-signature"); expect(html).not.toContain("hidden-seal");
    expect(html).not.toContain("Hidden signatory"); expect(html).not.toContain("report-signoff");
  });

  it("renders approved signature and seal slots only with approved data", () => {
    const document = previewDocument("MPT");
    document.approval = { approved: true, approvedAt: "2026-11-06T08:00:00Z", signatoryName: "FAKE TEST Reviewer", signatureUrl: "https://example.test/fake-signature.png", sealUrl: "https://example.test/fake-seal.png" };
    const html = renderToStaticMarkup(<MTReport document={document} />);
    expect(html).toContain("Approved signature and seal"); expect(html).toContain("FAKE TEST Reviewer");
    expect(html).toContain("fake-signature.png"); expect(html).toContain("fake-seal.png");
    expect(html).not.toContain("DRAFT");
  });

  it("supports multiple technician and item rows and escapes their content", () => {
    const document = previewDocument("DPT");
    document.readings.technicians = [...document.readings.technicians!, { name: "<script>test</script>" }];
    document.readings.items = [...document.readings.items!, { description: "Second fake component", quantity: 0, observations: "Test only" }];
    const html = renderToStaticMarkup(<DPTReport document={document} />);
    expect(html).toContain('rowSpan="3"'); expect(html).toContain("Second fake component");
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
  });

  it("keeps all required method fields represented in the paper formats", () => {
    for (const method of ["UT", "MPT", "DPT"] as ReportMethod[]) {
      const document = previewDocument(method);
      for (const definition of METHOD_FIELDS[method]) document.readings[definition.key] = `TEST-${definition.key}`;
      const html = renderToStaticMarkup(<ReportTemplate method={method} document={document} />);
      for (const definition of METHOD_FIELDS[method]) expect(html).toContain(`TEST-${definition.key}`);
    }
  });
});
