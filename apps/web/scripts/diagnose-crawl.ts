/**
 * Explains why a crawl's per-page reporting is empty.
 *
 * Distinguishes the two causes that look identical in the dashboard: the
 * migration has not been applied, or the worker process is running older code
 * that does not record page events.
 *
 *   npx tsx scripts/diagnose-crawl.ts
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { db } = await import("../src/lib/db/client");
  const { sql } = await import("drizzle-orm");

  const [table] = await db.execute<{ present: boolean }>(sql`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'crawl_pages'
    ) as present
  `);
  console.log(
    `crawl_pages table .......... ${table?.present ? "present" : "MISSING -> run: npm run db:migrate"}`,
  );

  const [column] = await db.execute<{ present: boolean }>(sql`
    select exists (
      select 1 from information_schema.columns
      where table_name = 'crawl_jobs' and column_name = 'phase'
    ) as present
  `);
  console.log(
    `crawl_jobs.phase column .... ${column?.present ? "present" : "MISSING -> run: npm run db:migrate"}`,
  );

  if (!table?.present || !column?.present) return;

  const jobs = await db.execute<{
    id: string;
    status: string;
    phase: string;
    pages_processed: number;
    events: number;
    finished_at: Date | null;
  }>(sql`
    select j.id, j.status, j.phase, j.pages_processed,
           (select count(*)::int from crawl_pages p where p.job_id = j.id) as events,
           j.finished_at
    from crawl_jobs j
    order by j.updated_at desc
    limit 5
  `);

  console.log("\nrecent jobs (newest first):");
  for (const job of jobs) {
    console.log(
      `  ${job.id.slice(0, 8)}  status=${job.status.padEnd(9)} phase=${String(job.phase).padEnd(9)} pages=${String(job.pages_processed).padStart(5)}  page_events=${String(job.events).padStart(5)}`,
    );
  }

  const stale = jobs.find(
    (job) => job.pages_processed > 0 && job.events === 0,
  );
  console.log("");
  if (stale) {
    console.log(
      "DIAGNOSIS: a job processed pages but recorded no page events.\n" +
        "The worker process is running code from before per-page reporting was\n" +
        "added. Restart the worker (it runs from source via tsx, so a restart is\n" +
        "all that is needed after `git pull`).",
    );
  } else if (jobs.every((job) => job.events > 0)) {
    console.log("DIAGNOSIS: page events are being recorded correctly.");
  } else {
    console.log("DIAGNOSIS: no completed jobs yet. Run a sync and check again.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
