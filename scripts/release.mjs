#!/usr/bin/env node
/**
 * Bump version, commit, tag v*, push — CI publishes on the tag.
 *
 *   pnpm release              # patch
 *   pnpm release minor|major
 *   pnpm release 0.3.0
 *   pnpm release --dry-run
 *   pnpm release --no-push
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLATFORMS_PATH = join(ROOT, "src/lib/capture-platforms.json");
const VERSION_RE = /^\d+\.\d+\.\d+$/;

const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("-")));
const dryRun = flags.has("--dry-run");
const noPush = flags.has("--no-push");

function die(message) {
  console.error(message);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, runArgs, { allowFail = false } = {}) {
  const r = spawnSync(command, runArgs, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (!allowFail && r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    die(err || `${command} ${runArgs.join(" ")} failed (${r.status})`);
  }
  return r;
}

function runInherit(command, runArgs) {
  const r = spawnSync(command, runArgs, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function bumpSemver(version, kind) {
  const parts = version.split(".").map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    die(`Invalid version: ${version}`);
  }
  let [major, minor, patch] = parts;
  if (kind === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === "minor") {
    minor += 1;
    patch = 0;
  } else if (kind === "patch") {
    patch += 1;
  } else {
    die(`Unknown bump: ${kind}`);
  }
  return `${major}.${minor}.${patch}`;
}

function resolveNextVersion(current) {
  const raw = args[0] ?? "patch";
  if (VERSION_RE.test(raw)) {
    if (raw === current) die(`Already at ${current}`);
    return raw;
  }
  if (raw === "patch" || raw === "minor" || raw === "major") {
    return bumpSemver(current, raw);
  }
  die(`Usage: pnpm release [patch|minor|major|x.y.z] [--dry-run] [--no-push]`);
}

const status = run("git", ["status", "--porcelain"]);
if (status.stdout.trim() && !dryRun) {
  die("Working tree is dirty. Commit or stash first.");
}

const branch = run("git", ["branch", "--show-current"]).stdout.trim();
const defaultBranch = run("git", [
  "rev-parse",
  "--abbrev-ref",
  "origin/HEAD",
]).stdout
  .trim()
  .replace(/^origin\//, "");
if (branch && defaultBranch && branch !== defaultBranch) {
  console.warn(`Warning: on '${branch}' (default is '${defaultBranch}').`);
}

const rootPkgPath = join(ROOT, "package.json");
const rootPkg = readJson(rootPkgPath);
const current = rootPkg.version;
if (!VERSION_RE.test(current)) die(`Invalid package.json version: ${current}`);

const next = resolveNextVersion(current);
const tag = `v${next}`;

const tagExists = run("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], {
  allowFail: true,
});
if (tagExists.status === 0) die(`Tag ${tag} already exists`);

console.log(`${current} → ${next} (tag ${tag})`);
if (dryRun) {
  console.log("Dry run only; no changes.");
  process.exit(0);
}

rootPkg.version = next;
writeJson(rootPkgPath, rootPkg);

const platforms = readJson(PLATFORMS_PATH);
for (const p of platforms) {
  const pkgPath = join(ROOT, "npm", p.package, "package.json");
  const pkg = readJson(pkgPath);
  pkg.version = next;
  writeJson(pkgPath, pkg);
}

const message = `chore: ${next}`;
const toAdd = ["package.json"];
for (const p of platforms) {
  toAdd.push(join("npm", p.package, "package.json"));
}
runInherit("git", ["add", ...toAdd]);
runInherit("git", ["commit", "-m", message]);
runInherit("git", ["tag", tag]);

if (noPush) {
  console.log(`Committed and tagged ${tag}. Push skipped (--no-push).`);
  process.exit(0);
}

runInherit("git", ["push", "origin", "HEAD"]);
runInherit("git", ["push", "origin", tag]);
console.log(`Pushed ${tag}. CI will build and publish.`);
