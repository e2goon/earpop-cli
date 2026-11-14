import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";

/** Points HOME at a fresh directory for the enclosing suite, so tests never touch real settings. */
export function useTempHome() {
  const home = mkdtempSync(join(tmpdir(), "earpop-test-"));
  const savedHome = process.env.HOME;
  before(() => {
    process.env.HOME = home;
  });
  after(() => {
    process.env.HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });
  return home;
}
