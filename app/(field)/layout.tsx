import Link from "next/link";
import type { ReactNode } from "react";

// Technician area: phone-first web/PWA companion + APK notice.
export default function FieldLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-line bg-white px-5 py-3">
        <Link href="/technician" className="flex items-center gap-2.5">
          <span className="grid h-[26px] w-[26px] place-items-center rounded-[7px] bg-ink text-[12px] font-bold text-white">
            BI
          </span>
          <span className="text-[13.5px] font-semibold">BITA Field App</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg border border-line bg-paper px-3 py-1 text-[12px] font-medium text-ink-2 hover:text-ink"
          >
            Office Dashboard
          </Link>
        </div>
      </header>
      <main className="flex-1 px-2 pb-8 pt-2">{children}</main>
    </div>
  );
}
