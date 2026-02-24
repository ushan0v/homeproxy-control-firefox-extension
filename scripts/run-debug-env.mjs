import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");

function startProcess(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`[debug-env] ${name} exited by signal: ${signal}`);
      return;
    }
    if (code && code !== 0) {
      console.error(`[debug-env] ${name} exited with code ${code}`);
      process.exit(code);
    }
  });

  return child;
}

const mockApi = startProcess("mock-api", "node", ["scripts/mock-api-server.mjs"], {
  MOCK_API_TOKEN: process.env.MOCK_API_TOKEN || "playwright-token",
});
const vite = startProcess("vite", "npm", ["run", "dev:harness"]);

console.log("[debug-env] open: http://127.0.0.1:4173/?harness=1");
console.log("[debug-env] mock API: http://127.0.0.1:7878 (token: playwright-token)");

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[debug-env] shutting down (${signal})`);
  mockApi.kill("SIGTERM");
  vite.kill("SIGTERM");
  setTimeout(() => process.exit(0), 250);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
