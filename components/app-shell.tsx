"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { signOut } from "@/app/(auth)/login/actions";
import { globalSearch } from "@/app/(office)/search-action";
import { roleLabel } from "@/lib/roles";
import { moveSearchIndex, type SearchResponse } from "@/lib/search";
import { Avatar, Mono } from "./ui";

/*
 * Office navigation (DESIGN.md). Five places instead of a long menu:
 * Today, Jobs, Reports, Money, Records. Each place lists its own pages,
 * so every existing screen stays one tap away. Each role gets its own set (D-015).
 * Desktop and tablet: a left rail. Phone: a bottom bar for the thumb, plus the
 * current place's pages as large tabs at the top of the screen.
 */

type NavItem = { href: string; label: string; count?: number };
type Section = { key: string; label: string; icon: keyof typeof ICONS; items: NavItem[] };
export type NavCounts = Partial<Record<"enquiries" | "quotations" | "jobs" | "reports", number>>;

const ICONS = {
  today: "M4 11.5 12 4l8 7.5M6.5 10v10h11V10M10 20v-5h4v5",
  jobs: "M3.5 7.5h17v12h-17zM8.5 7.5V4.5h7v3M3.5 12.5h17",
  reports: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 15.5h5",
  money: "M3.5 6.5h17v11h-17zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM6.5 9.5v5M17.5 9.5v5",
  records: "M4 5h6v14H4zM10 5h6v14h-6zM16 6l4 1-3 13-4-1",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35",
} as const;

function sectionsFor(roles: readonly string[], c: NavCounts): Section[] {
  const management = roles.includes("management");
  const office = roles.includes("office");
  const reviewer = roles.includes("reviewer");

  if (management || office) {
    return [
      {
        key: "today",
        label: "Today",
        icon: "today",
        items: management
          ? [
              { href: "/dashboard", label: "Today" },
              { href: "/office", label: "Office day" },
            ]
          : [{ href: "/office", label: "Today" }],
      },
      {
        key: "jobs",
        label: "Jobs",
        icon: "jobs",
        items: [
          { href: "/jobs", label: "Jobs" },
          { href: "/calendar", label: "Calendar" },
          { href: "/enquiries", label: "Enquiries", count: c.enquiries },
          { href: "/quotations", label: "Quotations", count: management ? c.quotations : undefined },
          { href: "/log-book", label: "Log book" },
        ],
      },
      { key: "reports", label: "Reports", icon: "reports", items: [{ href: "/review", label: "Reports", count: c.reports }] },
      {
        key: "money",
        label: "Money",
        icon: "money",
        items: [
          { href: "/invoices", label: "Invoices & payments" },
          ...(management ? [{ href: "/finance", label: "Finance" }] : []),
          { href: "/invoices/export", label: "CA GST files" },
          { href: "/price-list", label: "Price list" },
        ],
      },
      {
        key: "records",
        label: "Records",
        icon: "records",
        items: [
          { href: "/customers", label: "Customers" },
          { href: "/employees", label: "Employees" },
          { href: "/registers", label: "Certificates & qualifications" },
          { href: "/equipment", label: "Equipment" },
          { href: "/field-app", label: "Technician phone app" },
          { href: "/settings", label: "Settings" },
          ...(management
            ? [
                { href: "/settings/users", label: "Users & logins" },
                { href: "/recycle-bin", label: "Recycle bin" },
              ]
            : []),
        ],
      },
    ];
  }
  if (reviewer) {
    return [
      { key: "reports", label: "Reports", icon: "reports", items: [{ href: "/review", label: "Reports to review", count: c.reports }] },
      { key: "jobs", label: "Jobs", icon: "jobs", items: [{ href: "/jobs", label: "Jobs" }] },
      {
        key: "records",
        label: "Records",
        icon: "records",
        items: [
          { href: "/employees", label: "Employees" },
          { href: "/equipment", label: "Equipment" },
          { href: "/registers", label: "Certificates & qualifications" },
        ],
      },
    ];
  }
  return [];
}

// The page the user is on: the longest menu link that the current path starts with.
function activeHref(sections: Section[], pathname: string): string | null {
  let best: string | null = null;
  for (const s of sections)
    for (const i of s.items)
      if ((pathname === i.href || pathname.startsWith(i.href + "/")) && (!best || i.href.length > best.length)) best = i.href;
  return best;
}

function Icon({ name, className = "h-5 w-5" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={`${className} shrink-0 fill-none stroke-current`} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

function Count({ n, inverse }: { n?: number; inverse?: boolean }) {
  if (!n) return null;
  return (
    <span className={`ml-auto min-w-6 rounded px-1.5 text-center font-sign text-[13px] font-bold leading-6 ${inverse ? "bg-white text-sign" : "bg-sign text-white"}`}>
      {n}
    </span>
  );
}

function GlobalSearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResponse>({ query: "", groups: [], flat: [] });
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  // Close search dropdown on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Ctrl+K / Cmd+K global shortcut focuses the visible search input
  useEffect(() => {
    function onWindowKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        const el = inputRef.current;
        if (el && el.offsetParent !== null) {
          e.preventDefault();
          el.focus();
          el.select();
          setOpen(true);
        }
      } else if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, []);

  // Outside click closes dropdown
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Debounced server search
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults({ query: "", groups: [], flat: [] });
      setActiveIndex(-1);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await globalSearch(trimmed);
        if (!cancelled) {
          setResults(res);
          setActiveIndex(res.flat.length > 0 ? 0 : -1);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((idx) => moveSearchIndex(idx, 1, results.flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((idx) => moveSearchIndex(idx, -1, results.flat.length));
    } else if (e.key === "Enter") {
      const target = results.flat[activeIndex] ?? results.flat[0];
      if (target) {
        e.preventDefault();
        setOpen(false);
        router.push(target.href);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-white px-3 text-[15px] text-ink focus-within:border-sign focus-within:ring-2 focus-within:ring-sign/15">
        <span className="text-ink-3">
          <Icon name="search" />
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKeyDown}
          placeholder="Search jobs, customers, reports…"
          aria-label="Global search"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-3 focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded lg:inline border border-line bg-side px-1.5 py-0.5 font-mono text-[13px] text-ink-3">
          Ctrl K
        </kbd>
      </div>

      {open && query.trim().length > 0 && (
        <div
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 z-40 mt-1.5 max-h-[60vh] overflow-y-auto rounded-lg border border-line bg-white p-1.5 shadow-[0_8px_24px_rgba(17,20,24,0.12)] md:w-[380px]"
        >
          {loading && results.flat.length === 0 ? (
            <div className="px-3 py-4 text-[14px] text-ink-3">Searching…</div>
          ) : results.groups.length === 0 ? (
            <div className="px-3 py-4 text-[14px] text-ink-3">
              No matching jobs, customers, reports, enquiries or quotations.
            </div>
          ) : (
            results.groups.map((grp) => (
              <div key={grp.group} className="mb-1.5 last:mb-0">
                <div className="px-2.5 py-1 font-sign text-[13px] font-bold uppercase tracking-[0.06em] text-ink-3">
                  {grp.group}
                </div>
                <ul>
                  {grp.items.map((item) => {
                    const flatIdx = results.flat.findIndex(
                      (f) => f.group === item.group && f.id === item.id
                    );
                    const selected = flatIdx === activeIndex;
                    return (
                      <li key={`${item.group}-${item.id}`}>
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          onMouseEnter={() => setActiveIndex(flatIdx)}
                          className={`block rounded-md px-2.5 py-2 text-[14px] ${
                            selected ? "bg-side text-ink" : "text-ink-2 hover:bg-side hover:text-ink"
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate font-medium text-ink">
                              {item.code && (
                                <span className="mr-1.5">
                                  <Mono>{item.code}</Mono>
                                </span>
                              )}
                              {item.title}
                            </span>
                          </div>
                          {item.subtitle && (
                            <div className="truncate text-[13px] text-ink-3">{item.subtitle}</div>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function AppShell({
  person,
  counts,
  children,
}: {
  person: { full_name: string; roles: string[] };
  counts: NavCounts;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const sections = sectionsFor(person.roles, counts);
  const current = activeHref(sections, pathname);
  const currentSection = sections.find((s) => s.items.some((i) => i.href === current)) ?? null;
  const sectionCount = (s: Section) => s.items.reduce((t, i) => t + (i.count ?? 0), 0);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  const select = (href: string) => {
    if (href !== pathname) setPendingHref(href);
  };

  return (
    <div className="min-h-screen bg-white md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      {pendingHref && (
        <div role="status" className="fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-sign/20">
          <div className="bita-loadbar h-full w-1/3 bg-sign" />
          <span className="sr-only">Loading…</span>
        </div>
      )}

      {/* Phone: top bar with search, then the current place's pages as tabs. */}
      <header className="relative z-20 border-b border-line bg-white md:hidden">
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
          <Org subtitle={roleLabel(person.roles)} />
          <form action={signOut}>
            <button className="min-h-10 rounded-md px-2 text-[14px] font-semibold text-ink-2 hover:text-ink">Log out</button>
          </form>
        </div>
        <div className="px-4 pb-3">
          <GlobalSearchBox />
        </div>
        {currentSection && currentSection.items.length > 1 && (
          <nav aria-label={`${currentSection.label} pages`} className="flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
            {currentSection.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => select(item.href)}
                aria-current={item.href === current ? "page" : undefined}
                className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-[14px] font-semibold ${
                  item.href === current ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2"
                }`}
              >
                {item.label}
                {!!item.count && <span className="font-sign text-[13px] font-bold">{item.count}</span>}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {/* Desktop and tablet: the left rail. */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-side md:flex">
        <div className="px-4 pb-3 pt-4">
          <Org subtitle={roleLabel(person.roles)} />
        </div>
        <div className="px-3 pb-3">
          <GlobalSearchBox />
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
          {sections.map((s) => {
            const open = s === currentSection;
            return (
              <div key={s.key}>
                <Link
                  href={s.items[0]!.href}
                  onClick={() => select(s.items[0]!.href)}
                  aria-current={open && s.items.length === 1 ? "page" : undefined}
                  className={`flex min-h-12 items-center gap-3 rounded-md px-3 font-sign text-[19px] font-bold ${
                    open ? "bg-ink text-white" : "text-ink hover:bg-white"
                  }`}
                >
                  <Icon name={s.icon} />
                  {s.label}
                  <Count n={sectionCount(s)} inverse={open} />
                </Link>
                {open && s.items.length > 1 && (
                  <ul className="mb-2 mt-1 space-y-0.5 pl-11 pr-1">
                    {s.items.map((item) => {
                      const here = item.href === current;
                      const pending = pendingHref === item.href;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={() => select(item.href)}
                            aria-current={here ? "page" : undefined}
                            className={`flex min-h-9 items-center gap-2 rounded-md px-2.5 text-[15px] ${
                              here || pending ? "bg-white font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-ink-2 hover:bg-white hover:text-ink"
                            }`}
                          >
                            {item.label}
                            <Count n={item.count} />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <Avatar name={person.full_name} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[15px] font-semibold text-ink">{person.full_name}</div>
            <form action={signOut}>
              <button className="text-[14px] text-ink-3 hover:text-ink">Log out</button>
            </form>
          </div>
        </div>
      </aside>

      <main
        className="min-w-0 px-4 pb-28 pt-5 sm:px-6 md:px-10 md:pb-12 md:pt-8"
        onClick={(e) => {
          const anchor = (e.target as HTMLElement | null)?.closest("a");
          const href = anchor?.getAttribute("href");
          if (
            href &&
            href.startsWith("/") &&
            !href.startsWith("//") &&
            !anchor?.getAttribute("target") &&
            !anchor?.hasAttribute("download") &&
            href.split("?")[0] !== pathname
          ) {
            setPendingHref(href);
          }
        }}
      >
        <div className="mx-auto w-full max-w-[1200px]">{children}</div>
      </main>

      {/* Phone: the five places, at thumb height. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }}
      >
        {sections.map((s) => {
          const open = s === currentSection;
          const n = sectionCount(s);
          return (
            <Link
              key={s.key}
              href={s.items[0]!.href}
              onClick={() => select(s.items[0]!.href)}
              aria-current={open ? "page" : undefined}
              className={`relative flex min-h-16 flex-col items-center justify-center gap-1 font-sign text-[14px] font-bold ${open ? "text-sign" : "text-ink-2"}`}
            >
              {open && <span aria-hidden className="absolute inset-x-3 top-0 h-[3px] rounded-b bg-sign" />}
              <span className="relative">
                <Icon name={s.icon} className="h-6 w-6" />
                {!!n && (
                  <span className="absolute -right-3.5 -top-2 min-w-6 rounded bg-sign px-1 text-center text-[13px] leading-6 text-white">{n}</span>
                )}
              </span>
              {s.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function Org({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-sign font-sign text-[15px] font-bold tracking-[0.02em] text-white">BITA</span>
      <div className="min-w-0 leading-tight">
        <div className="truncate font-sign text-[17px] font-bold text-ink">Bangalore Inspection</div>
        <div className="truncate text-[13px] text-ink-3">{subtitle}</div>
      </div>
    </div>
  );
}
