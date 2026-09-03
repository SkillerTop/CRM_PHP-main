import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.CRM_BACKEND_URL || "http://127.0.0.1:8080";
  const proxyTimeout = Number.parseInt(env.CRM_PROXY_TIMEOUT_MS || "900000", 10);

  return {
    plugins: [react()],
    base: "/",
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server: {
      proxy: {
        "/api": {
          target: backendUrl,
          changeOrigin: false,
          timeout: proxyTimeout,
          proxyTimeout,
        },
      },
    },
    preview: {
      proxy: {
        "/api": {
          target: backendUrl,
          changeOrigin: false,
          timeout: proxyTimeout,
          proxyTimeout,
        },
      },
    },
  };
});
