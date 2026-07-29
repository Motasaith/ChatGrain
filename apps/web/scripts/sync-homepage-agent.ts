import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { ensureHomepageAgent } = await import(
    "../src/lib/agents/homepage-agent"
  );
  const agentId = await ensureHomepageAgent();
  if (!agentId) {
    throw new Error(
      "Set DOCENT_SITE_URL or NEXT_PUBLIC_APP_URL before syncing the homepage agent.",
    );
  }
  process.stdout.write(
    `Homepage support agent ${agentId} is queued for refresh.\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
