#!/usr/bin/env node
/**
 * Build earpop-capture for this host and stage into npm/<package>/bin/.
 * Cross-platform release binaries are produced by GitHub Actions (.github/workflows/capture.yml).
 */
import { join } from "node:path";
import { ROOT, runOrExit } from "./lib.mjs";

runOrExit({ command: "cargo", args: ["build", "--release", "-p", "earpop-capture"] });
runOrExit({
  command: process.execPath,
  args: [join(ROOT, "scripts/stage-capture.mjs"), "--host"],
});
