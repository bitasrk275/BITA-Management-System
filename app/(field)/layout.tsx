import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui";
import { requireTechnician } from "@/lib/auth";
import { signOut } from "../(auth)/login/actions";

// Technician area: phone first, logged in (D-015, D-016). Web screens retired in favour of Android APK.
export default async function FieldLayout({ children }: { children: ReactNode }) {
  const { person } = await requireTechnician();
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col bg-white">
      <header className="flex items-center justify-between px-5 pb-2 pt-4">
        <Link href="/technician" className="flex items-center gap-2.5">
          <span className="grid h-[26px] w-[26px] place-items-center rounded-[7px] bg-ink text-[12px] font-bold text-white">BI</span>
          <span className="text-[13.5px] font-semibold">BITA</span>
        </Link>
        <div className="flex items-center gap-3">
          <form action={signOut}>
            <button className="text-[13px] text-ink-2 hover:text-ink">Log out</button>
          </form>
          <Avatar name={person.full_name} />
        </div>
      </header>
      <main className="flex-1 px-5 pb-8 pt-2">{children}</main>
    </div>
  );
}
