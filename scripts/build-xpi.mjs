import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const artifactsDir = "web-ext-artifacts";
const filename = "homeproxy_control.xpi";
const outputFile = path.join(artifactsDir, filename);

mkdirSync(artifactsDir, { recursive: true });
for (const entry of readdirSync(artifactsDir)) {
  if (!entry.toLowerCase().endsWith(".xpi")) continue;
  rmSync(path.join(artifactsDir, entry), { force: true });
}
rmSync(outputFile, { force: true });

execSync(
  `web-ext build --source-dir dist --artifacts-dir ${artifactsDir} --filename ${filename}`,
  { stdio: "inherit" },
);
