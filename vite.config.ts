import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: process.env.BROWSER !== "none",
    strictPort: true,
    proxy: {
      // The hosted API checks same-origin GETs against the Host header, so keep it
      // as the frontend origin (string shorthand would rewrite it to the API port).
      "/api": process.env.VITE_GOT_IT_MODE === "hosted" ? { target: "http://127.0.0.1:8788", changeOrigin: false } : "http://127.0.0.1:8787",
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    environment: "jsdom",
    globals: true,
  },
});
