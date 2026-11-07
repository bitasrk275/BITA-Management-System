import type { Metadata } from "next";
import { requireTechnician } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Technician mobile app · BITA",
};

export default async function TechnicianNoticePage() {
  await requireTechnician();

  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-side text-ink">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-6 w-6 fill-none stroke-current"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="5" y="2" width="14" height="20" rx="3" />
          <path d="M12 18h.01" />
        </svg>
      </div>

      <h1 className="text-[17px] font-semibold text-ink">
        Please use the BITA phone app. Ask the office for a link code.
      </h1>

      <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">
        Technicians record field data, take photos, and track assignments through the BITA Android app. Contact the office to generate a 6-digit link code to pair your phone.
      </p>

      <div className="mt-8 w-full rounded-2xl border border-line bg-side p-5 text-left">
        <div className="text-[13px] font-medium text-ink">How to link your phone:</div>
        <ol className="mt-2.5 list-inside list-decimal space-y-2 text-[13px] text-ink-2">
          <li>Install the BITA technician APK on your Android device.</li>
          <li>Ask the office staff to go to <span className="font-medium text-ink">Registers → Link a phone</span>.</li>
          <li>Enter the 6-digit pairing code shown by the office.</li>
        </ol>
      </div>
    </div>
  );
}
