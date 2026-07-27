import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://docent:docent@localhost:5434/docent";

const globalForDb = globalThis as unknown as {
  postgresClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.postgresClient ??
  postgres(connectionString, {
    max: process.env.NODE_ENV === "production" ? 20 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => undefined,
  });

if (process.env.NODE_ENV !== "production") globalForDb.postgresClient = client;

export const db = drizzle(client, { schema });
export { client as sqlClient };
