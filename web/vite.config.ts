import { defineConfig } from "vite";

// `npm run dev` serves the front end on :5173 and forwards API calls to the Python core on :8000.
// `npm run build` writes the production site to web/dist, which the Python core serves.
export default defineConfig({
  base: "/",
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000", "/uploads": "http://127.0.0.1:8000" } },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2022",
    chunkSizeWarningLimit: 700,
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
  },
});
