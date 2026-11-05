import { defineConfig } from "vite";
export default defineConfig({
  build: { outDir: "dist/client" },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/socket.io": { target: "http://127.0.0.1:3000", ws: true },
      "/health": "http://127.0.0.1:3000",
    },
  },
});
