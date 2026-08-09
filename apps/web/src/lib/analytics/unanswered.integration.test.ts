import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

/** The lateral join and make_interval only prove out against real Postgres. */
let database: ReturnType<typeof drizzle>;
let client: PGlite;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  get db() {
    return database;
  },
}));

const WORKSPACE = "22222222-2222-2222-2222-222222222222";
const AGENT = "11111111-1111-1111-1111-111111111111";
const CONVO = "33333333-3333-3333-3333-333333333333";

beforeAll(async () => {
  client = await PGlite.create({ extensions: { vector } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  const dir = join(process.cwd(), "drizzle");
  for (const file of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(join(dir, file), "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim()) await client.exec(statement.trim());
    }
  }
  database = drizzle(client);

  await client.exec(`
    insert into workspaces (id, name, slug) values ('${WORKSPACE}', 'W', 'w');
    insert into agents (id, workspace_id, name) values ('${AGENT}', '${WORKSPACE}', 'HOC');
    insert into conversations (id, agent_id, session_id) values ('${CONVO}', '${AGENT}', 's1');
  `);

  // A thread where two questions were answered and two were not, with an
  // operator message between one pair to prove the pairing is not row-order.
  const rows: Array<[string, string, boolean | null, string]> = [
    ["user", "what are your shipping times", null, "2026-08-01T10:00:00Z"],
    ["assistant", "Shipping takes 3 days.", true, "2026-08-01T10:00:05Z"],
    ["user", "do you ship to canada", null, "2026-08-01T10:01:00Z"],
    ["assistant", "I could not find that.", false, "2026-08-01T10:01:05Z"],
    ["user", "can you ship to canada please", null, "2026-08-02T09:00:00Z"],
    ["operator", "Checking for you.", null, "2026-08-02T09:00:30Z"],
    ["assistant", "I could not find that.", false, "2026-08-02T09:01:00Z"],
  ];
  for (const [role, content, grounded, at] of rows) {
    await client.query(
      `insert into messages (conversation_id, role, content, grounded, created_at)
       values ($1, $2, $3, $4, $5)`,
      [CONVO, role, content, grounded, at],
    );
  }
}, 120_000);

afterAll(async () => {
  await client?.close();
});

describe("unansweredQuestions", () => {
  it("pairs each refusal with the question that caused it", async () => {
    const { unansweredQuestions } = await import("./unanswered");
    // A wide window, since the fixture dates are fixed.
    const gaps = await unansweredQuestions(WORKSPACE, { days: 36_500 });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].count).toBe(2);
    expect(gaps[0].question.toLowerCase()).toContain("canada");
  });

  it("ignores questions the agent answered", async () => {
    const { unansweredQuestions } = await import("./unanswered");
    const gaps = await unansweredQuestions(WORKSPACE, { days: 36_500 });
    expect(
      gaps.some((gap) => gap.question.includes("shipping times")),
    ).toBe(false);
  });

  it("does not pair across an operator message", async () => {
    // Row order would have picked the operator's line; the lateral join walks
    // back to the last visitor message instead.
    const { unansweredQuestions } = await import("./unanswered");
    const gaps = await unansweredQuestions(WORKSPACE, { days: 36_500 });
    expect(gaps[0].variants.concat(gaps[0].question).join(" ")).not.toContain(
      "Checking for you",
    );
  });

  it("returns nothing for another workspace", async () => {
    const { unansweredQuestions } = await import("./unanswered");
    const gaps = await unansweredQuestions(
      "99999999-9999-9999-9999-999999999999",
      { days: 36_500 },
    );
    expect(gaps).toEqual([]);
  });

  it("respects the time window", async () => {
    const { unansweredQuestions } = await import("./unanswered");
    expect(await unansweredQuestions(WORKSPACE, { days: 1 })).toEqual([]);
  });
});
