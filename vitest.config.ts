import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolves the "@/..." import alias from tsconfig.json for tests (Next.js resolves it in the app build).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    exclude: ["**/node_modules/**", "apps/**", ".next/**"],
  },
});
