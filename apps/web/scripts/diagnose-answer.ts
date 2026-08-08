/**
 * Explains, stage by stage, why an agent answered - or refused to answer - a
 * question.
 *
 * "It refused but I know that page was crawled" has at least four distinct
 * causes that look identical from the widget: the page was never indexed, it
 * was indexed but not retrieved, it was retrieved but scored under the
 * grounding threshold, or the model saw it and still declined. Each needs a
 * different fix, so guessing between them wastes a re-crawl per attempt.
 *
 *   npx tsx --tsconfig tsconfig.voice.json scripts/diagnose-answer.ts "<question>" [url-substring]
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function heading(text: string) {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

async function main() {
  const question = process.argv[2];
  const urlNeedle = process.argv[3];
  if (!question) {
    console.error(
      'Usage: npx tsx --tsconfig tsconfig.voice.json scripts/diagnose-answer.ts "<question>" [url-substring]',
    );
    process.exitCode = 1;
    return;
  }

  const { db } = await import("../src/lib/db/client");
  const { sql } = await import("drizzle-orm");
  const { hybridRetrieve } = await import("../src/lib/rag/retrieve");
  const { retrievalQueryTerms, siteStopWords } = await import(
    "../src/lib/rag/query-terms"
  );

  const agentRows = await db.execute<{
    id: string;
    name: string;
    strict_mode: boolean;
    documents: number;
    chunks: number;
    embedded: number;
  }>(sql`
    select a.id, a.name, a.strict_mode,
      (select count(*) from documents d
         join sources s on s.id = d.source_id where s.agent_id = a.id) as documents,
      (select count(*) from chunks c where c.agent_id = a.id) as chunks,
      (select count(*) from chunks c where c.agent_id = a.id and c.embedding is not null) as embedded
    from agents a order by a.created_at
  `);

  heading("Agents");
  for (const row of agentRows) {
    console.log(
      `${row.name}  [${row.id}]  strict=${row.strict_mode}  docs=${row.documents}  chunks=${row.chunks}  embedded=${row.embedded}`,
    );
  }
  if (!agentRows.length) return;

  // Largest corpus is almost always the one being asked about.
  const agent = [...agentRows].sort(
    (a, b) => Number(b.chunks) - Number(a.chunks),
  )[0];
  heading(`Diagnosing: ${agent.name}`);
  console.log(`question: ${question}`);
  // Term selection decides more than half the confidence score, so show what
  // survived and what the site's own vocabulary removed.
  const rootUrls = await db.execute<{ root_url: string | null }>(sql`
    select root_url from sources where agent_id = ${agent.id}::uuid
  `);
  const siteWords = siteStopWords(
    rootUrls.map((row) => row.root_url).filter((url): url is string => !!url),
  );
  console.log(`site words (dropped when other terms survive): ${
    JSON.stringify([...siteWords])
  }`);
  const terms = retrievalQueryTerms(question, { siteWords });
  console.log(`query terms: ${JSON.stringify(terms)}`);
  if (!terms.length) {
    console.log(
      "WARNING: no terms survived. Lexical and title scoring both go to zero.",
    );
  }

  // Stage 1: is the page in the index at all?
  if (urlNeedle) {
    const docs = await db.execute<{
      title: string;
      canonical_url: string;
      chunk_count: number;
      embedded: number;
    }>(sql`
      select d.title, d.canonical_url,
        (select count(*) from chunks c where c.document_id = d.id) as chunk_count,
        (select count(*) from chunks c where c.document_id = d.id and c.embedding is not null) as embedded
      from documents d
      join sources s on s.id = d.source_id
      where s.agent_id = ${agent.id}::uuid and d.canonical_url ilike ${"%" + urlNeedle + "%"}
      order by d.canonical_url limit 25
    `);
    heading(`Stage 1 - indexed pages matching "${urlNeedle}"`);
    if (!docs.length) {
      console.log("NONE. The page is not in the index; retrieval cannot find");
      console.log("what was never stored. Check the crawl's per-page outcome");
      console.log("(indexed / duplicate / thin / failed) and the source's");
      console.log("page_limit - a source created before the limit was raised");
      console.log("keeps its old cap on every re-crawl.");
    } else {
      for (const d of docs) {
        console.log(
          `${d.chunk_count} chunks (${d.embedded} embedded)  ${d.canonical_url}  "${d.title}"`,
        );
      }
    }
  }

  // Stage 2: does retrieval surface it?
  const hits = await hybridRetrieve(agent.id, question, 10);
  heading("Stage 2 - retrieval (top 10)");
  if (!hits.length) console.log("NO HITS.");
  hits.forEach((hit, index) => {
    console.log(
      `${index + 1}. rank=${hit.rankScore.toFixed(3)} vec=${hit.vectorScore.toFixed(3)} kw=${hit.keywordScore.toFixed(3)} lex=${hit.lexicalScore.toFixed(2)} title=${hit.titleScore.toFixed(2)}`,
    );
    console.log(`   ${hit.title}`);
    console.log(`   ${hit.url ?? "(no url)"}`);
  });

  // Stage 3: the grounding gate, using the same formula as the answer path.
  const best = hits[0];
  const confidence = best
    ? Math.max(
        0,
        Math.min(
          1,
          best.vectorScore * 0.4 +
            Math.max(0, Math.min(best.keywordScore, 0.8)) * 0.22 +
            best.lexicalScore * 0.2 +
            best.titleScore * 0.35,
        ),
      )
    : 0;
  const threshold = agent.strict_mode ? 0.3 : 0.18;
  heading("Stage 3 - grounding gate");
  console.log(`confidence ${confidence.toFixed(3)} vs threshold ${threshold}`);
  console.log(
    confidence < threshold
      ? "REFUSED HERE. The fallback message was returned without calling the model."
      : "PASSED. The model received this evidence, so a refusal came from the model itself.",
  );
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
