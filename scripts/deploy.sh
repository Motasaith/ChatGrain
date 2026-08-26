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

# The PM2 process names, overridable for an installation that uses others.
#
# Checked before anything is changed, not at the end. These were wrong for a
# real deployment - the script said "docent-app" while the server ran
# "chatgrain" - and because the restart is the last step under `set -e`, the
# failure landed after the build had already replaced the running code. A name
# mismatch now costs a message, not a half-finished deploy.
PM2_APPS="${PM2_APPS:-chatgrain chatgrain-worker chatgrain-voice}"

echo "==> Checking PM2 processes"
missing=""
for app in $PM2_APPS; do
  if ! pm2 describe "$app" >/dev/null 2>&1; then
    missing="$missing $app"
  fi
done
if [ -n "$missing" ]; then
  echo "    Not found in pm2:$missing" >&2
  echo "    Running processes:" >&2
  pm2 list --no-color >&2
  echo >&2
  echo "    Set PM2_APPS to match, for example:" >&2
  echo "      PM2_APPS=\"web worker voice\" bash scripts/deploy.sh" >&2
  exit 1
fi
echo "    $PM2_APPS"

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
# shellcheck disable=SC2086 # word splitting is how the list is passed
pm2 restart $PM2_APPS --update-env

echo
echo "==> Deployed ${after:0:7}"
pm2 list
