import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://docent:docent@localhost:5434/docent";

const globalForDb = globalThis as unknown as {
  postgresClient?: ReturnType<typeof postgres>;
};

/**
 * Pool size per process, not per deployment.
 *
 * Three processes share one database - the web app, the crawl worker and the
 * voice gateway - and a hosted Postgres caps total connections far lower than a
 * local container does. Aiven's plan here allows 20, of which the provider
 * reserves a few for itself, so a 20-connection web pool alone would starve the
 * worker and leave `drizzle-kit` unable to connect at all.
 */
const poolSize = Number(process.env.DATABASE_POOL_MAX?.trim()) || 5;

const client =
  globalForDb.postgresClient ??
  postgres(connectionString, {
    max: poolSize,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => undefined,
  });

if (process.env.NODE_ENV !== "production") globalForDb.postgresClient = client;

export const db = drizzle(client, { schema });
export { client as sqlClient };
