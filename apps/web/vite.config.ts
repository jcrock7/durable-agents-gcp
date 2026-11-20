import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `pnpm --filter @agents/web dev` serves the UI on 5173 and forwards /api to the API on 8080
// (run it locally, or kubectl port-forward svc/api 8080:80). Set API_URL to use another API, e.g. the k3d ingress.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:8080", changeOrigin: true } } },
});
