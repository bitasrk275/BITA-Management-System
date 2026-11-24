// Checks every `.from("table").select("...")` in app/ and lib/ against the real database schema.
// Each query runs with limit 0 (no rows read), so it only proves that PostgREST accepts the
// columns and embeds. Catches missing columns and ambiguous embeds that the unit tests' fake
// database cannot. Usage: node scripts/check-queries.mjs   (needs .env.local)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Helpers like invoicesTable(supabase) wrap .from("invoices").
const HELPERS = { invoicesTable: "invoices", invoiceLinesTable: "invoice_lines", paymentsTable: "payments" };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const found = [];
for (const file of [...walk(join(root, "app")), ...walk(join(root, "lib"))]) {
  const src = readFileSync(file, "utf8");
  const re =
    /(?:\.from\(\s*["'`](\w+)["'`]\s*\)|(\w+Table)\(\s*\w+\s*\))\s*\.select\(\s*(["'`])([\s\S]*?)\3/g;
  let m;
  while ((m = re.exec(src))) {
    const table = m[1] ?? HELPERS[m[2]];
    const cols = m[4];
    if (!table || cols.includes("${")) continue;
    const line = src.slice(0, m.index).split("\n").length;
    found.push({ where: `${relative(root, file)}:${line}`, table, cols: cols.replace(/\s+/g, " ").trim() });
  }
}

let bad = 0;
for (const q of found) {
  const { error } = await sb.from(q.table).select(q.cols).limit(0);
  if (error) {
    bad++;
    console.log(`FAIL ${q.where}  ${q.table}: ${error.message}${error.hint ? `  (hint: ${error.hint})` : ""}`);
  }
}
console.log(`${found.length} queries checked, ${bad} failed.`);
process.exit(bad ? 1 : 0);
