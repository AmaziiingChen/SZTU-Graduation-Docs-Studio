import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    // Hosted runners have 2–3 cores; keep DOM integration tests from competing for all memory.
    ...(process.env.CI ? { maxWorkers: 2, testTimeout: 15_000 } : {}),
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
  },
})
