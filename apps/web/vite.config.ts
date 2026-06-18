import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  server: {
    // Évite le CORS en dev : /api est relayé vers le backend Fastify.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
