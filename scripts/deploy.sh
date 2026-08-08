#!/usr/bin/env bash
#
# One command to put main on the VPS.
#
#   bash scripts/deploy.sh
#
# Exists because the manual sequence has bitten us twice: a `git pull` that
# aborted on a locally-rewritten lockfile while the following commands carried
# on against stale code, and `db:migrate` on a database that has only ever been
# schema-pushed. This fails loudly at the first problem instead.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Discarding local lockfile changes"
# npm rewrites this on the server whenever platform binaries differ. It is
# never a change worth keeping, and it is what silently blocks the pull.
git checkout -- package-lock.json 2>/dev/null || true

echo "==> Pulling"
before=$(git rev-parse HEAD)
git pull --ff-only
after=$(git rev-parse HEAD)

if [ "$before" = "$after" ]; then
  echo "    Already up to date at ${after:0:7}."
else
  echo "    ${before:0:7} -> ${after:0:7}"
  git --no-pager log --oneline "$before..$after"
fi

echo "==> Installing dependencies"
npm ci

echo "==> Applying schema"
# This project has always been schema-pushed, so the migrations journal is not
# populated and `drizzle-kit migrate` would try to replay 0000 over live tables.
npm run db:push --workspace @docent/web

echo "==> Building"
npm run build --workspace @docent/web

echo "==> Restarting"
# --update-env so a changed .env actually reaches the processes.
pm2 restart docent-app docent-worker docent-voice --update-env

echo
echo "==> Deployed ${after:0:7}"
pm2 list
