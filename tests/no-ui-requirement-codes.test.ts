import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");

const UI_REQUIREMENT_CODE_PATTERN =
  /\((R[0-9]{1,2}(,\s*[RX][0-9]{1,2})*|X[1-4]|G[0-9]{1,2}|P[0-9][a-d]?|A[0-9]|D-[0-9]{3}|T[0-9]{1,2})\)|Client (Feature|Change) [0-9]+|R[0-9]{1,2} notebook/;

function collectTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") {
      continue;
    }
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectTsxFiles(full));
    } else if (full.endsWith(".tsx") && !full.endsWith(".test.tsx")) {
      results.push(full);
    }
  }
  return results;
}

describe("G11 – No internal requirement codes in user-visible UI (.tsx)", () => {
  it("contains zero internal requirement codes across app/, components/, and apps/technician/src/", () => {
    const dirs = [
      join(REPO_ROOT, "app"),
      join(REPO_ROOT, "components"),
      join(REPO_ROOT, "apps", "technician", "src"),
    ];

    const violations: string[] = [];

    for (const dir of dirs) {
      for (const file of collectTsxFiles(dir)) {
        const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
        const lines = readFileSync(file, "utf8").split(/\r?\n/);
        lines.forEach((line, idx) => {
          const trimmed = line.trim();
          // Ignore single-line code comments (// ...)
          if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
            return;
          }
          const match = line.match(UI_REQUIREMENT_CODE_PATTERN);
          if (match) {
            violations.push(`${rel}:${idx + 1}: ${match[0]} in "${trimmed}"`);
          }
        });
      }
    }

    expect(violations).toEqual([]);
  });
});
