import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import("./worker").catch((error) => {
  console.error("Failed to start the Docent worker", error);
  process.exitCode = 1;
});
