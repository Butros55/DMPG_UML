import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        // SSE: disable all proxy timeouts so long-running AI streams stay alive
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          // Disable socket timeouts on both sides for SSE connections
          proxy.on("proxyReq", (proxyReq, req, res) => {
            if (req.url?.includes("/ai/analyze")) {
              // @ts-ignore – socket is defined
              req.socket?.setTimeout(0);
              // @ts-ignore – socket is defined
              (res as any).socket?.setTimeout(0);
            }
          });
          proxy.on("proxyRes", (proxyRes, req, res) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              // Disable buffering for SSE
              proxyRes.headers["x-accel-buffering"] = "no";
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
              // Also disable timeouts on the response side
              // @ts-ignore
              proxyRes.socket?.setTimeout(0);
              // @ts-ignore
              (res as any).socket?.setTimeout(0);
            }
          });
        },
      },
    },
  },
});
