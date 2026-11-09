import type { Metadata } from "next";
import Link from "next/link";
import { TechnicianWebApp } from "@/components/technician-web-app";

export const metadata: Metadata = {
  title: "BITA Field Technician App",
};

export default function FieldAppPage() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-xs font-bold text-white">
              BI
            </span>
            <span className="text-[13.5px] font-semibold text-ink">
              BITA Field Mobile App (Web & PWA)
            </span>
          </div>
          <Link
            href="/dashboard"
            className="rounded-lg border border-line bg-paper px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink"
          >
            ← Back to Office Dashboard
          </Link>
        </div>
      </header>
      <TechnicianWebApp />
    </div>
  );
}
