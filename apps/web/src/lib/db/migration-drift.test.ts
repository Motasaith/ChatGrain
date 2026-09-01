import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Indexes created by a raw migration but not declared in the schema file.
 *
 * These vanish. `npm run db:push` runs on every deploy and treats
 * `schema.ts` as the truth, so anything it finds in the database and not in
 * that file is dropped — including an index a migration created minutes
 * earlier. It is silent, it is reported as ordinary output nobody reads, and
 * the index is simply gone until somebody applies the migration again, at which
 * point the next deploy drops it again.
 *
 * It has already happened three times in this project:
 * `impersonation_grants_lookup_idx`, `impersonation_grants_pending_idx` and
 * `admin_sessions_open_idx` were all created by migrations, dropped by the next
 * `db:push`, and only noticed because a deploy log was read closely.
 *
 * So: every index a migration creates must also be declared in the schema. The
 * alternative — writing it only in the schema and letting `db:push` create it —
 * is fine too. What is not fine is the two files disagreeing, and this test only
 * ever complains about that.
 */

const DRIZZLE = join(import.meta.dirname, "..", "..", "..", "drizzle");
const SCHEMA = join(import.meta.dirname, "schema.ts");

/**
 * Index names the migrations leave in place.
 *
 * Read in filename order, adding on CREATE and removing on DROP, because an
 * index a later migration drops is not drift — it is history. `crawl_pages` was
 * re-keyed from the job that found a page to the source that owns it, and the
 * indexes from before that change are supposed to be gone.
 */
function migrationIndexes() {
  const names = new Set<string>();
  const files = readdirSync(DRIZZLE)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(DRIZZLE, file), "utf8")
      // A commented-out statement is not a statement.
      .replace(/^\s*--.*$/gm, "");
    for (const match of sql.matchAll(
      /(CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([a-z0-9_]+)"?/gi,
    )) {
      if (match[1].toUpperCase() === "DROP") names.delete(match[2]);
      else names.add(match[2]);
    }
  }
  return names;
}

/** Index names the schema declares. */
function schemaIndexes() {
  const source = readFileSync(SCHEMA, "utf8");
  const names = new Set<string>();
  for (const match of source.matchAll(
    /\b(?:unique)?[Ii]ndex\(\s*"([a-z0-9_]+)"\s*\)/g,
  )) {
    names.add(match[1]);
  }
  return names;
}

describe("migrations and the schema agree on indexes", () => {
  const fromMigrations = migrationIndexes();
  const fromSchema = schemaIndexes();

  it("reads both sides", () => {
    // Guards the guard: a wrong path or a changed convention would make the
    // assertion below pass against nothing at all.
    expect(fromMigrations.size).toBeGreaterThan(5);
    expect(fromSchema.size).toBeGreaterThan(5);
  });

  it("declares every index a migration creates", () => {
    const undeclared = [...fromMigrations]
      .filter((name) => !fromSchema.has(name))
      // Postgres names a primary key's implicit index after the constraint;
      // those are never declared separately and are not drift.
      .filter((name) => !name.endsWith("_pkey"))
      .sort();

    expect(undeclared).toEqual([]);
  });
});
