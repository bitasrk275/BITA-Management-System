import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { FormAwareButton } from "./form-button";

// Shared building blocks for every screen (DESIGN.md: "Plant Safety Signboard").
// Colour means one thing everywhere: blue = act, yellow = waiting, green = done, red = overdue.
// Every colour comes with a sign shape and words, never colour alone.

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-sign text-[28px] font-bold leading-[1.1] tracking-[-0.01em] text-ink text-balance sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-[70ch] text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2 sm:justify-end [&>*]:grow sm:[&>*]:grow-0">{action}</div>}
    </header>
  );
}

const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-[15px] font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sign disabled:cursor-not-allowed disabled:opacity-45";
const primary = "bg-sign text-white hover:bg-sign-deep active:bg-sign-deep";
const secondary = "border border-ink/25 bg-white text-ink hover:border-ink hover:bg-surface-2";
const small = "min-h-9 px-3 text-[14px]";

export function ButtonLink({ href, children, variant = "primary", size }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; size?: "sm" }) {
  return (
    <Link href={href} className={`${buttonBase} ${variant === "primary" ? primary : secondary} ${size === "sm" ? small : ""}`}>
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

const inputCore =
  "min-h-11 rounded-md border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-3 hover:border-ink-3 focus:border-sign focus:outline-none focus:ring-2 focus:ring-sign/15 disabled:bg-surface-2";
const inputClass = `mt-1.5 block w-full ${inputCore}`;
// A field placed inline (with its own width classes) keeps the look but not the stacked spacing.
const fieldClass = (className: string) => (className ? `${inputCore} ${className}` : inputClass);

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[14px] font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[13px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={fieldClass(className)} {...props} />;
}

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return <textarea className={fieldClass(className)} rows={3} {...props} />;
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select className={fieldClass(className)} {...props} />;
}

export function Checkbox({ label, ...props }: ComponentProps<"input"> & { label: string }) {
  return (
    <label className="flex min-h-9 items-center gap-2.5 text-[15px] text-ink">
      <input type="checkbox" className="h-5 w-5 shrink-0 accent-sign" {...props} />
      {label}
    </label>
  );
}

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mb-5 flex items-start gap-3 rounded-md border border-bad/30 bg-bad/5 px-4 py-3 text-[15px] text-bad">
      <SignSymbol tone="bad" size={20} />
      <span>{message}</span>
    </p>
  );
}

export function SavedNote() {
  return (
    <p role="status" className="mb-5 flex items-center gap-3 rounded-md border border-ok/30 bg-ok/5 px-4 py-3 text-[15px] font-medium text-ok">
      <SignSymbol tone="ok" size={20} />
      Saved.
    </p>
  );
}

// A bordered surface. Never nest one Card inside another.
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-white p-4 sm:p-5 ${className}`}>{children}</div>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="inline-block max-w-full rounded border border-line bg-surface-2 px-2 py-0.5 text-[13px] font-medium text-ink-2 [overflow-wrap:anywhere]">{children}</span>;
}

export type Tone = "bad" | "wait" | "ok" | "info" | "none";

/*
 * The plant safety-sign shapes, so status reads without colour too:
 * blue circle = you must act, yellow triangle = caution / waiting,
 * green square with a tick = done, red circle with a bar = overdue / stop.
 */
export function SignSymbol({ tone, size = 14 }: { tone: Tone; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true, className: "shrink-0" } as const;
  switch (tone) {
    case "info":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="var(--color-sign)" />
          <path d="M12 6.5v7.5M12 17.2v.3" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      );
    case "wait":
      return (
        <svg {...common}>
          <path d="M12 1.8 23 21.5H1z" fill="var(--color-caution)" stroke="#111418" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M12 8.5v6M12 17.6v.2" stroke="#111418" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );
    case "ok":
      return (
        <svg {...common}>
          <rect x="1" y="1" width="22" height="22" rx="3" fill="var(--color-ok)" />
          <path d="m6.5 12.5 3.6 3.6 7.4-8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "bad":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="var(--color-bad)" />
          <path d="M6.5 12h11" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill="none" stroke="var(--color-ink-3)" strokeWidth="2.4" />
        </svg>
      );
  }
}

// Status is a sign shape plus words, never colour alone.
export function StatusDot({ tone }: { tone: Tone }) {
  return <SignSymbol tone={tone} size={14} />;
}

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[14px] font-medium text-ink-2">
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

export function SectionTitle({ children, link }: { children: ReactNode; link?: { href: string; label: string } }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-sign text-[21px] font-bold leading-tight text-ink">{children}</h2>
      {link && (
        <Link href={link.href} className="shrink-0 text-[14px] font-semibold text-sign hover:underline">
          {link.label} →
        </Link>
      )}
    </div>
  );
}

// A bordered list of rows: sign shape, title with a detail line, and one action.
export function List({ children }: { children: ReactNode }) {
  return <ul className="overflow-hidden rounded-lg border border-line bg-white">{children}</ul>;
}

export function ListRow({ tone, title, detail, action, lead }: { tone?: Tone; title: ReactNode; detail?: ReactNode; action?: ReactNode; lead?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-line-2 px-4 py-3.5 first:border-t-0 hover:bg-surface-2">
      {lead ?? (tone && <StatusDot tone={tone} />)}
      <div className="min-w-0 flex-1 basis-48">
        <div className="font-semibold text-ink [overflow-wrap:anywhere]">{title}</div>
        {detail && <div className="mt-0.5 text-[14px] text-ink-3 [overflow-wrap:anywhere]">{detail}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <li className="px-4 py-6 text-[15px] text-ink-3">{children}</li>;
}

// The daily numbers (R39), in one divided strip.
export function Stats({ items }: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <dl className="mb-7 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-white lg:grid-cols-4">
      {items.map((s, i) => (
        <div
          key={s.label}
          className={`min-w-0 px-4 py-4 sm:px-5 ${i % 2 === 1 ? "border-l border-line" : ""} ${i >= 2 ? "border-t border-line lg:border-t-0" : ""} ${i >= 1 ? "lg:border-l" : ""}`}
        >
          <dt className="text-[14px] font-medium text-ink-2">{s.label}</dt>
          <dd className="mt-1 font-sign text-[30px] font-bold leading-none tabular-nums text-ink [overflow-wrap:anywhere] sm:text-[34px]">{s.value}</dd>
          {s.note && <div className="mt-1.5 text-[13px] text-ink-3">{s.note}</div>}
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px] tracking-[-0.01em]">{children}</span>;
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-side font-sign text-[14px] font-bold text-ink">
      {initials}
    </span>
  );
}

/*
 * The signboard: one sign per thing to do. The whole sign is the link;
 * its shape and colour say how urgent it is, the words say what to do.
 */
export function SignBoard({ children }: { children: ReactNode }) {
  return <ul className="grid gap-2.5 sm:grid-cols-2">{children}</ul>;
}

const signPlate: Record<Tone, string> = {
  info: "bg-sign text-white",
  wait: "bg-caution text-ink",
  ok: "bg-ok text-white",
  bad: "bg-bad text-white",
  none: "bg-side text-ink",
};
const signWord: Record<Tone, string> = { info: "Act", wait: "Waiting", ok: "Done", bad: "Overdue", none: "Note" };

export function Sign({ tone, title, detail, href, action }: { tone: Tone; title: ReactNode; detail?: ReactNode; href: string; action: string }) {
  return (
    <li className="min-w-0">
      <Link
        href={href}
        className="group flex h-full min-h-[84px] overflow-hidden rounded-lg border border-line bg-white transition-colors duration-150 hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sign"
      >
        <span className={`flex w-[72px] shrink-0 flex-col items-center justify-center gap-1.5 ${signPlate[tone]}`}>
          <SignPlateSymbol tone={tone} />
          <span className="font-sign text-[13px] font-bold uppercase tracking-[0.06em]">{signWord[tone]}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col justify-center px-4 py-3">
          <span className="font-sign text-[19px] font-bold leading-tight text-ink [overflow-wrap:anywhere]">{title}</span>
          {detail && <span className="mt-1 line-clamp-2 text-[14px] text-ink-2">{detail}</span>}
          <span className="mt-1.5 text-[14px] font-semibold text-sign group-hover:underline">{action} →</span>
        </span>
      </Link>
    </li>
  );
}

// The white pictogram printed on a sign plate (shape follows the plant sign it borrows from).
function SignPlateSymbol({ tone }: { tone: Tone }) {
  const p = { width: 28, height: 28, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  if (tone === "wait")
    return (
      <svg {...p}>
        <path d="M12 2.5 22.5 21h-21z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12 9v5.5M12 17.6v.2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  if (tone === "ok")
    return (
      <svg {...p}>
        <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (tone === "bad")
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M6.5 12h11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg {...p}>
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 6.8v6.8M12 16.8v.3" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/*
 * The job route: Enquiry → Quote → On site → Report → Invoice → Paid.
 * Done steps get the green tick, the current step is the blue "act" circle.
 */
export type RouteStep = { label: string; state: "done" | "current" | "todo"; detail?: ReactNode };

export function StepRoute({ steps }: { steps: RouteStep[] }) {
  return (
    <ol className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-6" aria-label="Job progress">
      {steps.map((s) => (
        <li
          key={s.label}
          aria-current={s.state === "current" ? "step" : undefined}
          className={`flex min-w-0 flex-col gap-1.5 px-3 py-3 ${s.state === "current" ? "bg-sign text-white" : "bg-white"}`}
        >
          <span className="flex items-center gap-2">
            {s.state === "done" ? (
              <SignSymbol tone="ok" size={18} />
            ) : s.state === "current" ? (
              <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden className="shrink-0">
                <circle cx="12" cy="12" r="10" fill="#fff" />
                <circle cx="12" cy="12" r="4.5" fill="var(--color-sign)" />
              </svg>
            ) : (
              <SignSymbol tone="none" size={18} />
            )}
            <span className={`font-sign text-[16px] font-bold leading-none ${s.state === "todo" ? "text-ink-3" : ""}`}>{s.label}</span>
          </span>
          {s.detail && (
            <span className={`truncate text-[13px] ${s.state === "current" ? "text-white/85" : "text-ink-3"}`}>{s.detail}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

// Folds secondary detail away so each screen shows one task first.
export function Fold({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-lg border border-line bg-white">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 font-sign text-[18px] font-bold text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="shrink-0 transition-transform duration-200 group-open:rotate-180">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}
