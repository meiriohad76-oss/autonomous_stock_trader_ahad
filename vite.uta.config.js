import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: path.join(rootDir, "src", "uta"),
  base: "/uta/",
  plugins: [react()],
  build: {
    outDir: path.join(rootDir, "src", "public", "uta"),
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});

