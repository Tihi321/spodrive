import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

function normalizeBase(b: string | undefined): string {
  let base = (b ?? "/").trim() || "/";
  if (!base.startsWith("/")) base = "/" + base;
  if (!base.endsWith("/")) base += "/";
  return base;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = normalizeBase(env.VITE_BASE || process.env.VITE_BASE);
  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        registerType: "prompt",
        injectRegister: false,
        includeAssets: ["favicon.svg", "favicon.ico", "apple-touch-icon-180x180.png"],
        manifest: {
          name: "Spodrive",
          short_name: "Spodrive",
          description: "Private, encrypted music player streaming from your Google Drive.",
          theme_color: "#0b0b0c",
          background_color: "#0b0b0c",
          display: "standalone",
          start_url: base,
          scope: base,
          icons: [
            { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        injectManifest: {
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
          rollupFormat: "iife",
        },
        devOptions: { enabled: true, type: "module", navigateFallback: "index.html" },
      }),
    ],
    build: { target: "es2022", sourcemap: false },
    server: { port: 5173 },
  };
});
