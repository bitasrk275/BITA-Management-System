export default function OfficeLoading() {
  return (
    <div className="animate-pulse space-y-6 py-2" role="status" aria-label="Loading page">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded-lg bg-line" />
          <div className="h-4 w-72 rounded bg-line-2" />
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-ink-3">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-3 border-t-ink" />
          Loading…
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="h-24 rounded-xl border border-line bg-white p-4">
          <div className="h-3.5 w-24 rounded bg-line-2" />
          <div className="mt-3 h-7 w-16 rounded bg-line" />
        </div>
        <div className="h-24 rounded-xl border border-line bg-white p-4">
          <div className="h-3.5 w-28 rounded bg-line-2" />
          <div className="mt-3 h-7 w-20 rounded bg-line" />
        </div>
        <div className="h-24 rounded-xl border border-line bg-white p-4">
          <div className="h-3.5 w-24 rounded bg-line-2" />
          <div className="mt-3 h-7 w-16 rounded bg-line" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="border-b border-line-2 px-4 py-3.5">
          <div className="h-4 w-56 rounded bg-line" />
        </div>
        <div className="divide-y divide-line-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3.5">
              <div className="space-y-1.5">
                <div className="h-4 w-44 rounded bg-line" />
                <div className="h-3 w-64 rounded bg-line-2" />
              </div>
              <div className="h-7 w-20 rounded-lg bg-line-2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
