import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who counts as an administrator, and who may say so.
 *
 * The property that matters most is the one that is easiest to lose by
 * accident: **the environment always wins**. Roles now live in a table, and a
 * table can be emptied by a bad migration, a mistaken click or a restored
 * backup. If the only route back in were the interface that just locked you
 * out, an installation would be one mistake away from needing a database
 * console to recover. `ADMIN_EMAILS` is the file on disk that the application
 * cannot edit, and these tests exist to keep it that way.
 */

const selectResult = vi.hoisted(() => ({ rows: [] as { role: string }[] }));
const dbThrows = vi.hoisted(() => ({ value: false }));

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (dbThrows.value) throw new Error("database unreachable");
            return selectResult.rows;
          },
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { email: "email", platformRole: "platform_role" },
}));

/**
 * Imported once, statically.
 *
 * `getAdminEmails()` reads `process.env` on every call rather than caching at
 * module load, so setting the variable per test is enough and there is nothing
 * to reset. An earlier version reset the module registry and re-imported for
 * each test, which cost a module graph rebuild every time and pushed the first
 * one past the five-second timeout whenever the machine was busy. A test that
 * fails under load is a test that gets disbelieved when it fails for a real
 * reason.
 */
import {
  isPlatformAdmin,
  isSuperAdmin,
  platformRoleFor,
  roleIsFixedByEnvironment,
} from "./roles";

describe("resolving a platform role", () => {
  beforeEach(() => {
    selectResult.rows = [];
    dbThrows.value = false;
    process.env.ADMIN_EMAILS = "boss@example.com, Second@Example.com";
  });

  afterEach(() => {
    delete process.env.ADMIN_EMAILS;
  });

  it("makes an address in the environment a superadmin", async () => {
    expect(await platformRoleFor("boss@example.com")).toBe("superadmin");
  });

  it("ignores case and surrounding space in the environment list", async () => {
    expect(await platformRoleFor("SECOND@example.com")).toBe("superadmin");
  });

  /**
   * The recovery path. A demotion written into the table must not be able to
   * take away access granted by the file on disk, or the way back in becomes
   * something the application itself can destroy.
   */
  it("lets the environment override a demotion in the database", async () => {
    selectResult.rows = [{ role: "member" }];
    expect(await platformRoleFor("boss@example.com")).toBe("superadmin");
    expect(await isSuperAdmin("boss@example.com")).toBe(true);
  });

  it("reads a role granted from the dashboard", async () => {
    selectResult.rows = [{ role: "admin" }];
    expect(await platformRoleFor("colleague@example.com")).toBe("admin");
    expect(await isPlatformAdmin("colleague@example.com")).toBe(true);
    // An administrator is not a super administrator. Being able to operate the
    // installation must not come with the power to hand that out.
    expect(await isSuperAdmin("colleague@example.com")).toBe(false);
  });

  it("treats an unknown address as a member", async () => {
    expect(await platformRoleFor("stranger@example.com")).toBe("member");
    expect(await isPlatformAdmin("stranger@example.com")).toBe(false);
  });

  it("treats an unrecognised stored value as a member", async () => {
    selectResult.rows = [{ role: "wizard" }];
    expect(await platformRoleFor("odd@example.com")).toBe("member");
  });

  /**
   * This runs on the path that renders every dashboard page. A database hiccup
   * must not take the application down for everybody, and the safe direction is
   * to grant nothing.
   */
  it("degrades to member when the database is unreachable", async () => {
    dbThrows.value = true;
    expect(await platformRoleFor("colleague@example.com")).toBe("member");
  });

  it("still admits the environment when the database is unreachable", async () => {
    dbThrows.value = true;
    expect(await platformRoleFor("boss@example.com")).toBe("superadmin");
  });

  it("knows which addresses configuration has fixed", async () => {
    expect(roleIsFixedByEnvironment("boss@example.com")).toBe(true);
    expect(roleIsFixedByEnvironment("colleague@example.com")).toBe(false);
  });

  it("grants nothing when the environment list is empty", async () => {
    process.env.ADMIN_EMAILS = "";
    expect(await platformRoleFor("anyone@example.com")).toBe("member");
  });
});
