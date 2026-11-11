import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  base: "/tos-personal-library/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    watch: { usePolling: true },
    // Dev stand-in for the same-origin /tome-of-secrets/ path production serves (bookTags.json).
    proxy: {
      "/tome-of-secrets": {
        target: process.env.TOS_JEKYLL_URL ?? "http://host.docker.internal:4000",
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    // e2e/ is Playwright's (npm run e2e), not Vitest's.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
