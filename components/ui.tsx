import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { FormAwareButton } from "@/components/form-button";

// Shared building blocks for every screen (DESIGN.md). Clean black and white; colour only for status.

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-2">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </header>
  );
}

const buttonBase =
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3.5 py-2 text-[13.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50";
const primary = "bg-ink text-white hover:bg-ink-2";
const secondary = "border border-line bg-white text-ink hover:bg-side";

export function ButtonLink({ href, children, variant = "primary", size }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; size?: "sm" }) {
  return (
    <Link href={href} className={`${buttonBase} ${variant === "primary" ? primary : secondary} ${size === "sm" ? "px-2.5 py-1.5 text-[13px]" : ""}`}>
      {children}
    </Link>
  );
}

export function Button({ className = "", ...props }: ComponentProps<"button">) {
  return <FormAwareButton className={`${buttonBase} ${primary} ${className}`} {...props} />;
}

export function SecondaryButton({ className = "", ...props }: ComponentProps<"button">) {
  return <FormAwareButton className={`${buttonBase} ${secondary} ${className}`} {...props} />;
}

const inputClass =
  "mt-1.5 block w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input className={inputClass} {...props} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea className={inputClass} rows={3} {...props} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select className={inputClass} {...props} />;
}

export function Checkbox({ label, ...props }: ComponentProps<"input"> & { label: string }) {
  return (
    <label className="flex items-center gap-2 text-[13.5px] text-ink">
      <input type="checkbox" className="h-4 w-4 accent-ink" {...props} />
      {label}
    </label>
  );
}

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mb-5 rounded-lg border border-bad/20 bg-bad/5 px-3.5 py-2.5 text-[13.5px] text-bad">{message}</p>;
}

export function SavedNote() {
  return <p className="mb-5 rounded-lg border border-ok/20 bg-ok/5 px-3.5 py-2.5 text-[13.5px] text-ok">Saved.</p>;
}

// A bordered surface. Never nest one Card inside another.
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-white p-4 ${className}`}>{children}</div>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-xs text-ink-2">{children}</span>;
}

export type Tone = "bad" | "wait" | "ok" | "info" | "none";
const toneClass: Record<Tone, string> = { bad: "bg-bad", wait: "bg-wait", ok: "bg-ok", info: "bg-info", none: "bg-ink-3" };

// Status is shown as a small dot plus words, never colour alone.
export function StatusDot({ tone }: { tone: Tone }) {
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${toneClass[tone]}`} />;
}

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink-2">
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

export function SectionTitle({ children, link }: { children: ReactNode; link?: { href: string; label: string } }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between">
      <h2 className="text-sm font-semibold text-ink">{children}</h2>
      {link && (
        <Link href={link.href} className="text-[13px] text-ink-2 hover:text-ink">
          {link.label}
        </Link>
      )}
    </div>
  );
}

// A bordered list of rows: status dot, title with a detail line, and one action.
export function List({ children }: { children: ReactNode }) {
  return <ul className="overflow-hidden rounded-xl border border-line bg-white">{children}</ul>;
}

export function ListRow({ tone, title, detail, action, lead }: { tone?: Tone; title: ReactNode; detail?: ReactNode; action?: ReactNode; lead?: ReactNode }) {
  return (
    <li className="flex items-center gap-3.5 border-t border-line-2 px-4 py-3 first:border-t-0 hover:bg-[#fcfcfc]">
      {lead ?? (tone && <StatusDot tone={tone} />)}
      <div className="min-w-0 flex-1">
        <div className="font-medium text-ink">{title}</div>
        {detail && <div className="mt-0.5 text-[12.5px] text-ink-3">{detail}</div>}
      </div>
      {action}
    </li>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <li className="px-4 py-5 text-[13.5px] text-ink-3">{children}</li>;
}

// The three daily numbers, in one divided strip (R39).
export function Stats({ items }: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <dl className="mb-7 grid grid-cols-1 divide-y divide-line overflow-hidden rounded-xl border border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {items.map((s) => (
        <div key={s.label} className="px-5 py-4">
          <dt className="text-[13px] text-ink-2">{s.label}</dt>
          <dd className="mt-1.5 text-[28px] font-semibold tracking-[-0.03em] tabular-nums text-ink">{s.value}</dd>
          {s.note && <div className="text-[12.5px] text-ink-3">{s.note}</div>}
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[12.5px]">{children}</span>;
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e5e5e5] text-[11px] font-semibold text-ink">
      {initials}
    </span>
  );
}
