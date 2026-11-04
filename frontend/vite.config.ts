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
      // Bind IPv4 explicitly and fail when the port is taken: with the default "localhost" Vite
      // silently starts on [::1] only while another dev server answers 127.0.0.1:5173, and /api
      // then returns that server's HTML ("The CRM server returned an invalid response").
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
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
