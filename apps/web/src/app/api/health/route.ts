import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { llmProviders } from "@/lib/llm/providers";
import appVersion from "../../../../package.json" with { type: "json" };
import { systemState } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = performance.now();
  let database: "up" | "down" = "down";
  let worker: "up" | "stale" | "unknown" = "unknown";
  try {
    await db.execute(sql`select 1`);
    database = "up";
    const [heartbeat] = await db
      .select({ updatedAt: systemState.updatedAt })
      .from(systemState)
      .where(eq(systemState.key, "worker"))
      .limit(1);
    worker = heartbeat
      ? Date.now() - heartbeat.updatedAt.getTime() < 15_000
        ? "up"
        : "stale"
      : "unknown";
  } catch {
    database = "down";
  }
  const ok = database === "up";
  // Labels only - never the model names or keys. This endpoint is reachable
  // without a session.
  let providerLabels: string[] = [];
  try {
    providerLabels = llmProviders().map((provider) => provider.label);
  } catch {
    providerLabels = [];
  }
  return NextResponse.json(
    {
      ok,
      // Read from the package rather than typed in. The literal here said
      // "0.2.0" for two releases, which is worse than reporting nothing: a
      // version string is only consulted when someone is trying to work out
      // which build they are looking at.
      version: process.env.npm_package_version ?? appVersion,
      services: {
        database,
        worker,
        // Reported, not assumed. This used to answer "local-transformer" for
        // every provider, so an installation serving embeddings from Cloudflare
        // was told it was running the model locally - the exact fact an
        // operator opens this page to check.
        embeddings: process.env.EMBEDDING_PROVIDER?.trim() || "local",
        generation: providerLabels.length
          ? providerLabels.join(", ")
          : "extractive",
      },
      latencyMs: Math.round(performance.now() - started),
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
