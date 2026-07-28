import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
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
  return NextResponse.json(
    {
      ok,
      version: "0.2.0",
      services: {
        database,
        worker,
        embeddings:
          process.env.EMBEDDING_PROVIDER === "hash"
            ? "local-hash"
            : "local-transformer",
        generation: process.env.LLM_API_KEY
          ? "ollama-cloud"
          : process.env.LLM_BASE_URL
            ? "ollama-compatible"
            : "extractive",
      },
      latencyMs: Math.round(performance.now() - started),
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
