import type { requireStaff } from "@/lib/auth";
import type { ReportApproval, ReportLetterhead } from "@/templates/reports/types";
import {
  DEFAULT_DEV_LETTERHEAD,
  fakeSealSvgDataUrl,
  fakeSignatureSvgDataUrl,
} from "./review";

type SupabaseClientType = Awaited<ReturnType<typeof requireStaff>>["supabase"];

export function dataUrlToBuffer(
  dataUrl?: string | null,
): { buffer: Buffer; mime: string } | null {
  if (!dataUrl || !dataUrl.startsWith("data:")) return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

export async function downloadBrandingImageDataUrl(
  supabase: SupabaseClientType,
  path: string | null | undefined,
): Promise<string | undefined> {
  if (!path || path.startsWith("/") || path.includes("..")) return undefined;
  try {
    let bucket = "branding";
    let objectPath = path;
    if (path.startsWith("documents/")) {
      bucket = "documents";
      objectPath = path.slice("documents/".length);
    } else if (path.startsWith("branding/")) {
      bucket = "branding";
      objectPath = path.slice("branding/".length);
    }

    let { data, error } = await supabase.storage.from(bucket).download(objectPath);
    if ((error || !data) && bucket === "branding") {
      // Fallback try documents bucket
      const retry = await supabase.storage.from("documents").download(`branding/${objectPath}`);
      if (!retry.error && retry.data) {
        data = retry.data;
        error = null;
      }
    }

    if (error || !data || data.size > 2 * 1024 * 1024) return undefined;
    const mime =
      data.type ||
      (path.endsWith(".svg")
        ? "image/svg+xml"
        : path.endsWith(".jpg") || path.endsWith(".jpeg")
          ? "image/jpeg"
          : "image/png");
    const buf = Buffer.from(await data.arrayBuffer());
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export async function loadReportLetterhead(
  supabase: SupabaseClientType,
): Promise<{
  letterhead: ReportLetterhead;
  sealPath?: string;
  defaultSignatoryId?: string;
}> {
  // 1. Check company_profile setting in settings table
  try {
    const { data: setting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "company_profile")
      .maybeSingle();

    if (
      setting?.value &&
      typeof setting.value === "object" &&
      !Array.isArray(setting.value)
    ) {
      const v = setting.value as Record<string, unknown>;
      const name =
        typeof v.name === "string" && v.name.trim()
          ? v.name.trim()
          : DEFAULT_DEV_LETTERHEAD.name;
      const addressLines =
        typeof v.address === "string" && v.address.trim()
          ? v.address
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean)
          : DEFAULT_DEV_LETTERHEAD.addressLines;

      const contactLines: string[] = [];
      if (typeof v.phone === "string" && v.phone.trim()) {
        contactLines.push(`Tel: ${v.phone.trim()}`);
      }
      if (typeof v.email === "string" && v.email.trim()) {
        contactLines.push(`Email: ${v.email.trim()}`);
      }

      const logoPath =
        typeof v.logo_path === "string" && v.logo_path.trim()
          ? v.logo_path.trim()
          : undefined;
      const sealPath =
        typeof v.seal_path === "string" && v.seal_path.trim()
          ? v.seal_path.trim()
          : undefined;
      const defaultSignatoryId =
        typeof v.default_signatory_id === "string" && v.default_signatory_id.trim()
          ? v.default_signatory_id.trim()
          : undefined;

      const logoUrl = logoPath
        ? await downloadBrandingImageDataUrl(supabase, logoPath)
        : undefined;

      return {
        letterhead: {
          name,
          addressLines:
            addressLines.length > 0
              ? addressLines
              : DEFAULT_DEV_LETTERHEAD.addressLines,
          contactLines:
            contactLines.length > 0
              ? contactLines
              : DEFAULT_DEV_LETTERHEAD.contactLines,
          ...(logoUrl ? { logoUrl } : {}),
        },
        sealPath,
        defaultSignatoryId,
      };
    }
  } catch {
    // Ignore and proceed to fallback
  }

  // 2. Legacy fallback: report-letterhead.json in branding storage
  try {
    const { data, error } = await supabase.storage
      .from("branding")
      .download("report-letterhead.json");
    if (!error && data && data.size <= 32 * 1024) {
      const parsed = JSON.parse(await data.text()) as Record<string, unknown>;
      if (
        typeof parsed.name === "string" &&
        parsed.name.trim() &&
        Array.isArray(parsed.addressLines)
      ) {
        const logoUrl =
          typeof parsed.logoPath === "string"
            ? await downloadBrandingImageDataUrl(supabase, parsed.logoPath)
            : undefined;
        return {
          letterhead: {
            name: parsed.name.trim(),
            addressLines: parsed.addressLines.map(String),
            contactLines: Array.isArray(parsed.contactLines)
              ? parsed.contactLines.map(String)
              : undefined,
            ...(logoUrl ? { logoUrl } : {}),
          },
          sealPath:
            typeof parsed.sealPath === "string" ? parsed.sealPath : undefined,
        };
      }
    }
  } catch {
    // Fall back to DEFAULT_DEV_LETTERHEAD
  }

  return { letterhead: DEFAULT_DEV_LETTERHEAD };
}

export async function loadReportApprovalAssets(
  supabase: SupabaseClientType,
  params: {
    approved: boolean;
    approvedAt: string | null;
    signatoryId: string | null;
    approvedBy: string | null;
  },
): Promise<{ letterhead: ReportLetterhead; approval: ReportApproval }> {
  const { letterhead, sealPath, defaultSignatoryId } =
    await loadReportLetterhead(supabase);

  if (!params.approved || !params.approvedAt) {
    return { letterhead, approval: { approved: false } };
  }

  const targetPersonId = params.signatoryId ?? params.approvedBy;
  let signatoryName = "Technical Reviewer";
  let signatoryQualification: string | undefined = "Technical Signatory";
  let signaturePath: string | null = null;

  if (targetPersonId) {
    const { data: person } = await supabase
      .from("people")
      .select("id, full_name, position, signature_path")
      .eq("id", targetPersonId)
      .maybeSingle();
    if (person) {
      signatoryName = person.full_name;
      signatoryQualification = person.position ?? undefined;
      signaturePath = person.signature_path;
    }
  }

  // Fallback to default signatory setting if target person has no signature uploaded
  if (!signaturePath && defaultSignatoryId) {
    const { data: defaultPerson } = await supabase
      .from("people")
      .select("id, full_name, position, signature_path")
      .eq("id", defaultSignatoryId)
      .maybeSingle();
    if (defaultPerson) {
      if (defaultPerson.signature_path) {
        signaturePath = defaultPerson.signature_path;
      }
      if (!targetPersonId) {
        signatoryName = defaultPerson.full_name;
        signatoryQualification = defaultPerson.position ?? undefined;
      }
    }
  }

  const [realSigUrl, realSealUrl] = await Promise.all([
    downloadBrandingImageDataUrl(supabase, signaturePath),
    downloadBrandingImageDataUrl(supabase, sealPath ?? "seal.png"),
  ]);

  return {
    letterhead,
    approval: {
      approved: true,
      approvedAt: params.approvedAt,
      signatoryName,
      ...(signatoryQualification ? { signatoryQualification } : {}),
      signatureUrl: realSigUrl ?? fakeSignatureSvgDataUrl(signatoryName),
      sealUrl: realSealUrl ?? fakeSealSvgDataUrl(),
    },
  };
}
