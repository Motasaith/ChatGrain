import { describe, expect, it } from "vitest";
import appPackage from "../../package.json" with { type: "json" };
import rootPackage from "../../../../package.json" with { type: "json" };

/**
 * The two package versions have to agree.
 *
 * `/api/health` reports a version so that someone looking at a running server
 * can tell which build it is. It reported the literal string "0.2.0" for two
 * releases; that was replaced with a read of `package.json`, and the read
 * pointed at the workspace package - whose version had never been maintained
 * and said 0.1.0. A wrong version is worse than none, because it is consulted
 * precisely when someone is trying to establish what is deployed.
 *
 * Rather than reaching outside the app directory at build time, the two are
 * kept in step and this fails the moment they drift.
 */
describe("package versions", () => {
  it("match between the workspace and the repository root", () => {
    expect(appPackage.version).toBe(rootPackage.version);
  });
});
