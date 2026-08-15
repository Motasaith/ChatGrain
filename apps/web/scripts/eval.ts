/**
 * Measures retrieval accuracy for one agent against a golden set.
 *
 *   npm run eval -w @docent/web -- --agent=<name or id>
 *   npm run eval -w @docent/web -- --agent=acme --generate=200
 *   npm run eval -w @docent/web -- --agent=acme --baseline
 *
 * Without --generate it reads the stored set for that agent, so a run is
 * repeatable and comparable. With --generate it samples chunks, asks an LLM to
 * write a question for each, and saves the result first.
 *
 * Exits non-zero when recall@8 has dropped against the stored baseline, which
 * is what makes this usable as a CI gate rather than a report nobody reads.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import nextEnv from "@next/env";
// Type-only, so it is erased at compile time and does not pull the module in
// before loadEnvConfig has run. Every runtime import below stays dynamic.
import type { EvalCase, EvalReport } from "../src/lib/eval/metrics";

nextEnv.loadEnvConfig(process.cwd());

const DIR = join(process.cwd(), ".data", "eval");

function arg(name: string) {
  const found = process.argv
    .slice(2)
    .find((value) => value.startsWith(`--${name}`));
  if (!found) return undefined;
  const [, value] = found.split("=");
  return value ?? "";
}

async function main() {
  const agentNeedle = arg("agent");
  if (!agentNeedle) {
    console.error(
      'Usage: npm run eval -w @docent/web -- --agent=<name or id> [--generate=200] [--baseline]',
    );
    process.exitCode = 1;
    return;
  }

  const { db } = await import("../src/lib/db/client");
  const { sql } = await import("drizzle-orm");
  const { generateCases, reviewSample } = await import("../src/lib/eval/golden-set");
  const { runEval, compareToBaseline } = await import("../src/lib/eval/run");
  const { formatReport } = await import("../src/lib/eval/metrics");

  const rows = await db.execute<{ id: string; name: string }>(sql`
    select id, name from agents
    where id::text = ${agentNeedle} or lower(name) like ${"%" + agentNeedle.toLowerCase() + "%"}
    limit 2
  `);
  const agents = (Array.isArray(rows) ? rows : (rows as { rows: typeof rows }).rows) ?? [];
  if (!agents.length) {
    console.error(`No agent matched "${agentNeedle}".`);
    process.exitCode = 1;
    return;
  }
  if (agents.length > 1) {
    console.error(`"${agentNeedle}" matched more than one agent. Use the id.`);
    process.exitCode = 1;
    return;
  }
  const agent = agents[0];
  mkdirSync(DIR, { recursive: true });
  const setPath = join(DIR, `${agent.id}.json`);
  const baselinePath = join(DIR, `${agent.id}.baseline.json`);

  let cases: EvalCase[];
  const generate = arg("generate");
  if (generate !== undefined) {
    const count = Number(generate) || 200;
    console.log(`Generating ~${count} cases for ${agent.name}...`);
    const generated = await generateCases(agent.id, { count });
    if (!generated.length) {
      console.error(
        "No cases generated. Is this agent indexed, and is an LLM provider configured?",
      );
      process.exitCode = 1;
      return;
    }
    writeFileSync(setPath, JSON.stringify(generated, null, 2));
    console.log(`Wrote ${generated.length} cases to ${setPath}`);
    console.log(
      `\nReview these ${Math.min(50, generated.length)} before trusting any number below:`,
    );
    for (const item of reviewSample(generated).slice(0, 50)) {
      console.log(`  Q: ${item.question}`);
      console.log(`     <- ${item.sourceUrl ?? item.sourceTitle ?? item.sourceChunkId}`);
    }
    cases = generated;
  } else {
    if (!existsSync(setPath)) {
      console.error(
        `No golden set for ${agent.name}. Create one with --generate=200`,
      );
      process.exitCode = 1;
      return;
    }
    cases = JSON.parse(readFileSync(setPath, "utf8")) as EvalCase[];
  }

  console.log(`\nRunning ${cases.length} cases against ${agent.name}...`);
  const report = await runEval(agent.id, cases, {
    onProgress: (done, total) => {
      if (done % 25 === 0 || done === total) {
        process.stdout.write(`  ${done}/${total}\r`);
      }
    },
  });
  console.log("\n");
  console.log(formatReport(report));

  if (arg("baseline") !== undefined) {
    writeFileSync(baselinePath, JSON.stringify(report, null, 2));
    console.log(`\nBaseline saved to ${baselinePath}`);
    return;
  }

  if (existsSync(baselinePath)) {
    const baseline = JSON.parse(
      readFileSync(baselinePath, "utf8"),
    ) as EvalReport;
    const verdict = compareToBaseline(report, baseline);
    console.log(`\n${verdict.summary}`);
    if (verdict.regressed) {
      console.error("\nRetrieval regressed against the baseline.");
      process.exitCode = 1;
    }
  } else {
    console.log(
      "\nNo baseline stored. Run again with --baseline to pin this result.",
    );
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
