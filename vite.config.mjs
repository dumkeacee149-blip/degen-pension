import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  // Source/master social artwork stays in public/ for production work, but is
  // not copied into every app deployment. The runtime allowlist is copied by
  // scripts/copy-runtime-public.mjs after Vite finishes.
  publicDir: command === "build" ? false : "public",
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
}));
