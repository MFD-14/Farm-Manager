import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  // Shown on the About screen; CI sets APP_VERSION_NAME to include the build number.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION_NAME || pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Woodlands Farm Manager",
        short_name: "Woodlands",
        description: "Offline-first farm operations: tasks, evidence, verification. © 2026 Musara Holdings LLC.",
        theme_color: "#1a5c2e",
        background_color: "#f7f3ed",
        display: "standalone",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // App shell cached; API traffic is handled by the outbox, never by SW caching
        // (capture must write locally first and never block on network, spec 7.2).
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        navigateFallback: "index.html",
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    proxy: { "/api": "http://127.0.0.1:4000" },
  },
});
