import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: process.env.BROWSER !== "none",
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    environment: "jsdom",
    globals: true,
  },
});
