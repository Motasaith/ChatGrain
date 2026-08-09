#!/usr/bin/env node
/**
 * Keeps a real env file and the template in step, in both directions.
 *
 *   node scripts/sync-env.mjs                 # fill .env.local from the template
 *   node scripts/sync-env.mjs --file .env     # same, for a server file
 *   node scripts/sync-env.mjs --to-example    # regenerate .env.example from it
 *
 * Values are never printed. The file is read, merged and written in place, and
 * only key names appear in the output, so this is safe to run over a file
 * holding production credentials.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const templatePath = resolve(repoRoot, ".env.example");

const args = process.argv.slice(2);
const toExample = args.includes("--to-example");
const fileArg = args[args.indexOf("--file") + 1];
const targetPath = resolve(
  repoRoot,
  args.includes("--file") && fileArg ? fileArg : "apps/web/.env.local",
);

// The logic lives in src so it is unit tested; this file is only plumbing.
const { syncEnv, redactEnv } = await import(
  "../apps/web/src/lib/config/env-sync.ts"
).catch(async () => {
  // Plain node cannot import TypeScript; fall back to the compiled copy or
  // tell the caller how to run it.
  console.error(
    "Run through tsx so the TypeScript helper can be imported:\n" +
      "  npx tsx scripts/sync-env.mjs",
  );
  process.exit(1);
});

if (!existsSync(templatePath)) {
  console.error(`Missing template: ${templatePath}`);
  process.exit(1);
}

if (toExample) {
  if (!existsSync(targetPath)) {
    console.error(`Missing source file: ${targetPath}`);
    process.exit(1);
  }
  const redacted = redactEnv(readFileSync(targetPath, "utf8"));
  copyFileSync(templatePath, `${templatePath}.bak`);
  writeFileSync(templatePath, redacted.endsWith("\n") ? redacted : `${redacted}\n`);
  console.log(`Wrote .env.example from ${targetPath} with secrets emptied.`);
  console.log("Previous template saved as .env.example.bak");
  console.log("Read the diff before committing: git diff .env.example");
  process.exit(0);
}

const template = readFileSync(templatePath, "utf8");
const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
const result = syncEnv(template, existing);

if (existsSync(targetPath)) copyFileSync(targetPath, `${targetPath}.bak`);
writeFileSync(
  targetPath,
  result.contents.endsWith("\n") ? result.contents : `${result.contents}\n`,
);

console.log(`Synced ${targetPath}`);
console.log(`  kept   ${result.kept.length} existing values`);
console.log(`  added  ${result.added.length} from the template`);
for (const key of result.added) console.log(`         + ${key}`);
if (result.extra.length) {
  console.log(`  extra  ${result.extra.length} not in the template`);
  for (const key of result.extra) console.log(`         ? ${key}`);
}
if (existing) console.log(`Previous file saved as ${targetPath}.bak`);
