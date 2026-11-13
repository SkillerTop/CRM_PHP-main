import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const backend = join(root, "backend-node");
const frontend = join(root, "frontend");
const envFile = join(root, "backend", ".env");

for (const [path, help] of [
  [envFile, "Copy backend/.env.example to backend/.env and configure MySQL."],
  [join(backend, "node_modules", "tsx"), "Run npm run setup first."],
  [join(frontend, "node_modules", "vite"), "Run npm run setup first."],
]) {
  if (!existsSync(path)) {
    console.error(help);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode !== 1) {
  const children = new Set();
  let stopping = false;

  function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) child.kill();
  }

  function start(name, cwd, args) {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: "inherit",
      windowsHide: true,
    });
    children.add(child);
    child.once("error", (error) => {
      console.error(`${name} could not start: ${error.message}`);
      stop(1);
    });
    child.once("exit", (code) => {
      children.delete(child);
      if (!stopping) {
        console.error(`${name} stopped with exit code ${code ?? "unknown"}.`);
        stop(code || 1);
      }
    });
  }

  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));

  start("Backend", backend, [
    "--env-file=../backend/.env",
    "--import",
    "tsx",
    "src/server.ts",
  ]);
  start("Frontend", frontend, ["node_modules/vite/bin/vite.js"]);
}
