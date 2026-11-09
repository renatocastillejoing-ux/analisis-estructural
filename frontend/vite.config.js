import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La app compilada se sirve desde Flask en /nueva (static/react/).
export default defineConfig({
  plugins: [react()],
  base: "/static/react/",
  build: { outDir: "../static/react", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:5000" } },
});
