import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin.ts";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
};

function codexFallbackBundlePlugin() {
  return {
    name: "codex:bundle-worker-runtime",
    enforce: "post" as const,
    configResolved(config: unknown) {
      if (process.env.CODEX_SKIP_CLOUDFLARE !== "1") return;
      const resolved = config as {
        ssr?: { external?: true | string[]; noExternal?: true | string[] };
        environments?: Record<string, { resolve?: { external?: true | string[]; noExternal?: true | string[] } }>;
      };
      resolved.ssr ??= {};
      resolved.ssr.external = [];
      resolved.ssr.noExternal = true;
      for (const name of ["rsc", "ssr"]) {
        const environment = resolved.environments?.[name];
        if (!environment) continue;
        environment.resolve ??= {};
        environment.resolve.external = [];
        environment.resolve.noExternal = true;
      }
    },
  };
}

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const cloudflarePlugins = process.env.CODEX_SKIP_CLOUDFLARE === "1"
    ? []
    : [
        (await import("@cloudflare/vite-plugin")).cloudflare({
          viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
          config: localBindingConfig,
        }),
      ];

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      ...(process.env.CODEX_SKIP_CLOUDFLARE === "1" ? [codexFallbackBundlePlugin()] : []),
      ...cloudflarePlugins,
    ],
  };
});
