import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

/**
 * Retrieval against a real Postgres.
 *
 * The unit tests cover term selection as a pure function, but they cannot
 * prove the SQL runs, that the ranking behaves on a realistic corpus, or that
 * a migration applies. PGlite is Postgres compiled to WASM, so this exercises
 * the genuine query planner, full-text search and pgvector rather than a mock.
 */

let database: ReturnType<typeof drizzle>;
let client: PGlite;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  get db() {
    return database;
  },
}));

/**
 * Deterministic stand-in for the sentence-transformer.
 *
 * Token hashing gives vectors whose similarity tracks word overlap, which is
 * close enough for ranking while keeping the test hermetic and fast - the real
 * model would download 25MB and dominate the runtime.
 */
/**
 * Function words a real sentence encoder does not hang meaning on. Without
 * this the stand-in rewards a body that merely repeats the question's
 * phrasing ("how", "work"), which a trained model would not, and the fixture
 * stops reflecting the production scores it stands in for.
 */
const FUNCTION_WORDS = new Set([
  "how", "does", "do", "the", "and", "or", "of", "for", "to", "in", "on",
  "is", "are", "it", "you", "your", "work", "works", "out", "each", "many",
  "much", "with", "across", "from", "by", "as", "at", "that", "this",
]);

function fakeEmbedding(text: string) {
  const dims = new Array(384).fill(0);
  for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (FUNCTION_WORDS.has(token)) continue;
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) {
      hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
    }
    dims[hash % 384] += 1;
  }
  const norm = Math.hypot(...dims) || 1;
  return dims.map((value) => value / norm);
}

vi.mock("@/lib/rag/embeddings", () => ({
  embedText: async (text: string) => fakeEmbedding(text),
  embedTexts: async (texts: string[]) => texts.map(fakeEmbedding),
}));

const AGENT = "11111111-1111-1111-1111-111111111111";
const WORKSPACE = "22222222-2222-2222-2222-222222222222";
const SOURCE = "33333333-3333-3333-3333-333333333333";

/** Mirrors projects-raspberry.com: every page is a "raspberry" "project". */
const CORPUS = [
  {
    title: "Raspberry Pi Camera Project",
    url: "https://projects-raspberry.com/camera/",
    body: "Build a motion sensing camera. Wire the module to the CSI port and enable the interface in raspi-config.",
  },
  {
    title: "Raspberry Pi Weather Station Project",
    url: "https://projects-raspberry.com/weather-station/",
    body: "Log temperature humidity and pressure from a BME280 sensor over I2C and publish readings to a dashboard.",
  },
  {
    title: "J-Flex Lithium Ion Battery Project",
    url: "https://projects-raspberry.com/j-flex-battery/",
    body: "A flexible lithium ion battery that bends without losing capacity, useful for wearable raspberry builds.",
  },
  {
    title: "Raspberry Pi Home Automation Project",
    url: "https://projects-raspberry.com/home-automation/",
    body: "Control relays and lights from a web interface, scheduling them with cron and exposing an MQTT topic.",
  },
];

async function applyMigrations(pg: PGlite) {
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      await pg.exec(trimmed);
    }
  }
  return files;
}

beforeAll(async () => {
  client = await PGlite.create({ extensions: { vector } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  await applyMigrations(client);
  database = drizzle(client);

  await client.exec(`
    insert into workspaces (id, name, slug) values ('${WORKSPACE}', 'Test', 'test');
    insert into agents (id, workspace_id, name) values ('${AGENT}', '${WORKSPACE}', 'Projects Raspberry');
    insert into sources (id, agent_id, type, name, root_url)
      values ('${SOURCE}', '${AGENT}', 'website', 'site', 'https://projects-raspberry.com/');
  `);

  for (const [index, page] of CORPUS.entries()) {
    const documentId = `4444444${index}-4444-4444-4444-444444444444`;
    const content = `${page.title}. ${page.body}`;
    await client.query(
      `insert into documents (id, source_id, canonical_url, title, content_hash)
       values ($1, $2, $3, $4, $5)`,
      [documentId, SOURCE, page.url, page.title, `hash-${index}`],
    );
    await client.query(
      `insert into chunks (document_id, source_id, agent_id, position, content, token_count, embedding)
       values ($1, $2, $3, 0, $4, $5, $6)`,
      [
        documentId,
        SOURCE,
        AGENT,
        content,
        Math.ceil(content.length / 4),
        JSON.stringify(fakeEmbedding(content)),
      ],
    );
  }
}, 120_000);

afterAll(async () => {
  await client?.close();
});

describe("migrations", () => {
  it("apply cleanly against a real Postgres", async () => {
    const tables = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema='public'`,
    );
    const names = tables.rows.map((row) => row.table_name);
    expect(names).toContain("chunks");
    expect(names).toContain("documents");
  });

  it("include the follow-up suggestions column", async () => {
    // Proves 0012 applies, rather than trusting that it was generated right.
    const columns = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name='agents'`,
    );
    expect(columns.rows.map((r) => r.column_name)).toContain(
      "follow_up_suggestions",
    );
  });
});

describe("exact title matches", () => {
  /** Real titles from homeofcalculators.com, where the exact page ranked 7th. */
  const HOC_AGENT = "77777777-7777-7777-7777-777777777777";
  const HOC_SOURCE = "88888888-8888-8888-8888-888888888888";
  const PAGES = [
    ["Time Calculator", "/calculators/time", "Add or subtract hours, minutes and seconds. Total seconds equals days times 86400 plus hours times 3600."],
    ["Time Duration Calculator", "/calculators/time-duration", "Calculate the duration between two times in hours minutes and seconds. Useful for tracking project work, shift logs, flight times and general intervals. Duration equals end time minus start time."],
    ["Study Time Calculator", "/calculators/study-time", "Plan revision hours across subjects and work out how much time each topic needs before an exam date."],
    ["Screen Time Calculator", "/calculators/screen-time", "Work out how many hours of screen time you spend each day across phone, laptop and television."],
    ["Time Card Calculator", "/calculators/time-card", "Add up clock in and clock out times for a work week and total the payable hours for each day."],
    ["Work Calculator", "/calculators/work", "Calculate mechanical work as force times distance in joules for a given displacement."],
  ];

  beforeAll(async () => {
    await client.exec(`
      insert into agents (id, workspace_id, name) values ('${HOC_AGENT}', '${WORKSPACE}', 'HOC');
      insert into sources (id, agent_id, type, name, root_url)
        values ('${HOC_SOURCE}', '${HOC_AGENT}', 'website', 'hoc', 'https://homeofcalculators.com/');
    `);
    for (const [index, [title, path, body]] of PAGES.entries()) {
      const documentId = `6666666${index}-6666-6666-6666-666666666666`;
      const fullTitle = `${title} | Home of Calculators`;
      await client.query(
        `insert into documents (id, source_id, canonical_url, title, content_hash)
         values ($1, $2, $3, $4, $5)`,
        [documentId, HOC_SOURCE, `https://homeofcalculators.com${path}`, fullTitle, `hoc-${index}`],
      );
      const content = `${title}. ${body}`;
      await client.query(
        `insert into chunks (document_id, source_id, agent_id, position, content, token_count, embedding)
         values ($1, $2, $3, 0, $4, $5, $6)`,
        [documentId, HOC_SOURCE, HOC_AGENT, content, 40, JSON.stringify(fakeEmbedding(content))],
      );
    }
  }, 60_000);

  it("puts the exactly-named page first", async () => {
    // Production ranked this 7th, behind four longer pages: ts_rank_cd rewards
    // repetition, and titleScore could not tell "Time Calculator" from
    // "Screen Time Calculator" because both contain every query word.
    const { hybridRetrieve } = await import("./retrieve");
    const hits = await hybridRetrieve(
      HOC_AGENT,
      "how does the time calculator work",
      6,
    );
    expect(hits[0].url).toBe("https://homeofcalculators.com/calculators/time");
  });

  it("still favours a different page when that one is named", async () => {
    // The signal must not simply prefer short titles.
    const { hybridRetrieve } = await import("./retrieve");
    const hits = await hybridRetrieve(HOC_AGENT, "time duration calculator", 6);
    expect(hits[0].url).toBe(
      "https://homeofcalculators.com/calculators/time-duration",
    );
  });
});

describe("duplicate chunks", () => {
  it("does not spend several evidence slots on identical text", async () => {
    // Observed in production: seven of the top ten hits were one page, two of
    // them with byte-identical scores. Every duplicate displaces a different
    // page from the evidence the model gets to read.
    const documentId = "55555555-5555-5555-5555-555555555555";
    const repeated =
      "Raspberry Pi Network Time Server. Sync clocks over NTP from a GPS module.";
    await client.query(
      `insert into documents (id, source_id, canonical_url, title, content_hash)
       values ($1, $2, $3, $4, $5)`,
      [
        documentId,
        SOURCE,
        "https://projects-raspberry.com/ntp-server/",
        "Raspberry Pi Network Time Server",
        "hash-ntp",
      ],
    );
    for (const position of [0, 1, 2]) {
      await client.query(
        `insert into chunks (document_id, source_id, agent_id, position, content, token_count, embedding)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          documentId,
          SOURCE,
          AGENT,
          position,
          repeated,
          20,
          JSON.stringify(fakeEmbedding(repeated)),
        ],
      );
    }

    const { hybridRetrieve } = await import("./retrieve");
    const hits = await hybridRetrieve(AGENT, "network time server ntp", 6);
    const identical = hits.filter((hit) => hit.content === repeated);
    expect(identical).toHaveLength(1);
  });
});

describe("hybridRetrieve against a real corpus", () => {
  it("finds the right page when the query is all site words plus one topic", async () => {
    const { hybridRetrieve } = await import("./retrieve");
    const hits = await hybridRetrieve(
      AGENT,
      "what raspberry pi camera projects do you have",
      6,
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].url).toBe("https://projects-raspberry.com/camera/");
  });

  it("scores a correct match above the strict grounding threshold", async () => {
    // The regression this guards: when every term was stripped, lexical and
    // title both went to zero and a correct match landed under 0.3, so the
    // agent refused a question it had the page for.
    const { hybridRetrieve } = await import("./retrieve");
    const [best] = await hybridRetrieve(
      AGENT,
      "raspberry pi weather station project",
      6,
    );
    const confidence =
      best.vectorScore * 0.4 +
      Math.max(0, Math.min(best.keywordScore, 0.8)) * 0.22 +
      best.lexicalScore * 0.2 +
      best.titleScore * 0.35;
    expect(best.url).toBe("https://projects-raspberry.com/weather-station/");
    expect(confidence).toBeGreaterThan(0.3);
  });

  it("answers a question made entirely of the site's own words", async () => {
    // The exact reported failure. Every word here is either question framing
    // or the site's own name, so the old global stopword list stripped the
    // query to nothing. Empty terms zero the lexical and title components -
    // 55% of the confidence weight - and the agent refused a question it had
    // four matching pages for.
    const { hybridRetrieve } = await import("./retrieve");
    const hits = await hybridRetrieve(
      AGENT,
      "what raspberry pi projects do you have",
      6,
    );
    expect(hits.length).toBeGreaterThan(0);
    const best = hits[0];
    const confidence =
      best.vectorScore * 0.4 +
      Math.max(0, Math.min(best.keywordScore, 0.8)) * 0.22 +
      best.lexicalScore * 0.2 +
      best.titleScore * 0.35;
    expect(confidence).toBeGreaterThan(0.3);
  });

  it("does not leak another agent's chunks", async () => {
    const { hybridRetrieve } = await import("./retrieve");
    const hits = await hybridRetrieve(
      "99999999-9999-9999-9999-999999999999",
      "raspberry pi camera",
      6,
    );
    expect(hits).toHaveLength(0);
  });
});
