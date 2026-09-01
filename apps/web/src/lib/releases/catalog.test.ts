import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASES, stableRelease } from "./catalog";

/**
 * Keeps the dashboard's summary honest about which releases exist.
 *
 * The catalogue is written by hand — the reasoning for that is in `catalog.ts`
 * — which means the way it fails is by going quietly out of date: a release
 * document gets added and the panel keeps describing the world as it was, on
 * the one screen whose entire job is telling an administrator what is running.
 *
 * This cannot check that the *summaries* are accurate. Nothing can. It checks
 * the things that are checkable, which are the ones that rot silently.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/** Release documents at the repository root. */
function releaseDocuments() {
  return readdirSync(ROOT).filter(
    (name) => /^RELEASE-\d+\.\d+\.\d+\.md$/.test(name),
  );
}

describe("the release catalogue", () => {
  it("finds the release documents", () => {
    // Guards the guard: a wrong path would make everything below vacuous.
    expect(releaseDocuments().length).toBeGreaterThan(0);
  });

  it("has an entry for every release document", () => {
    const described = new Set(RELEASES.map((release) => release.document));
    const missing = releaseDocuments().filter((doc) => !described.has(doc));
    expect(missing).toEqual([]);
  });

  it("points every entry at a document that exists", () => {
    const present = new Set(readdirSync(ROOT));
    const dangling = RELEASES.filter(
      (release) => !present.has(release.document),
    ).map((release) => `${release.version} → ${release.document}`);
    expect(dangling).toEqual([]);
  });

  /**
   * Exactly one. "Which version do we return to when this goes wrong" has to
   * have a single answer, and the whole point of the open releases is that they
   * are not it.
   */
  it("names exactly one stable release", () => {
    const stable = RELEASES.filter((release) => release.status === "stable");
    expect(stable).toHaveLength(1);
    expect(stableRelease()?.version).toBe(stable[0].version);
  });

  it("is ordered newest first", () => {
    const dates = RELEASES.map((release) => release.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("says what every release is for and where it came from", () => {
    for (const release of RELEASES) {
      expect(release.headline.length, release.version).toBeGreaterThan(30);
      expect(release.owns.length, release.version).toBeGreaterThan(0);
      expect(release.highlights.length, release.version).toBeGreaterThan(0);
      expect(release.restorePoint.length, release.version).toBeGreaterThan(0);
    }
  });

  /**
   * An open release with nothing listed as unproven is either finished — in
   * which case it should be stable — or is not being honest. Both are worth
   * catching.
   */
  it("makes every open release admit to something", () => {
    for (const release of RELEASES.filter((one) => one.status === "open")) {
      expect(release.unproven.length, release.version).toBeGreaterThan(0);
    }
  });

  /**
   * The version in package.json is what `/api/health` reports, and it is the
   * tagged one rather than either open release. Somebody reading "0.3.0" on a
   * health check needs the panel to explain that rather than contradict it.
   */
  it("agrees with the version the application reports", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as { version: string };
    expect(stableRelease()?.version).toBe(pkg.version);
  });
});
