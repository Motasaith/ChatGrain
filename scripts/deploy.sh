#!/usr/bin/env bash
#
# One command to put main on the VPS.
#
#   bash scripts/deploy.sh
#
# Every check in here is the residue of a deploy that went wrong. The manual
# sequence has bitten us with a `git pull` that aborted on a locally-rewritten
# lockfile while the following commands carried on against stale code; with
# `db:migrate` on a database that has only ever been schema-pushed; with PM2
# process names that did not exist, discovered only after the build had already
# replaced the running code; and with a real bug fix, hand-applied to a server
# and never committed, one `git checkout --` away from being lost.
#
# So it fails early and loudly rather than doing half a deploy. Nothing here is
# clever; it is a list of things that have actually happened.
set -euo pipefail

cd "$(dirname "$0")/.."

# The PM2 process names, overridable for an installation that uses others.
PM2_APPS="${PM2_APPS:-chatgrain chatgrain-worker chatgrain-voice}"
# Where the app listens locally, for the health check at the end.
APP_PORT="${APP_PORT:-5000}"

fail() {
  echo >&2
  echo "    $*" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Pre-flight. Everything that can be checked before anything is changed, is.
# ---------------------------------------------------------------------------

echo "==> Checking PM2 processes"
command -v pm2 >/dev/null 2>&1 || fail "pm2 is not on PATH. Is this the right machine?"
missing=""
for app in $PM2_APPS; do
  pm2 describe "$app" >/dev/null 2>&1 || missing="$missing $app"
done
if [ -n "$missing" ]; then
  echo "    Not found in pm2:$missing" >&2
  pm2 list --no-color >&2 || true
  fail "Set PM2_APPS to match, e.g. PM2_APPS=\"web worker voice\" bash scripts/deploy.sh"
fi
echo "    $PM2_APPS"

# npm rewrites the lockfile on a server whenever platform binaries differ. It is
# never a change worth keeping, and it is what silently blocks the pull.
git checkout -- package-lock.json 2>/dev/null || true

echo "==> Checking for local changes"
# Deliberately a refusal rather than a `git reset --hard`.
#
# A production server was once found carrying an uncommitted one-line fix to
# process-job.ts - a genuine bug fix for a Postgres error that silently
# destroyed a batch of page events. It was real, it was not in the repository,
# and a script that discarded local changes automatically would have deleted it
# with no trace. Stopping to show the diff costs a minute; the alternative cost
# would have been finding that bug a second time.
dirty="$(git status --porcelain -- ':!package-lock.json')"
if [ -n "$dirty" ]; then
  echo "    This checkout has changes that are not in git:" >&2
  echo "$dirty" | sed 's/^/      /' >&2
  echo >&2
  echo "    Look at them before deciding - someone may have fixed something here:" >&2
  echo "      git diff" >&2
  echo >&2
  echo "    Then either keep them:" >&2
  echo "      git stash && bash scripts/deploy.sh && git stash pop" >&2
  echo "    or discard them:" >&2
  fail "  git checkout -- . && git clean -fd && bash scripts/deploy.sh"
fi
echo "    Clean"

# ---------------------------------------------------------------------------
# Pull, and stop if the new code needs a migration this script cannot apply.
# ---------------------------------------------------------------------------

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

if [ "$before" != "$after" ]; then
  new_sql="$(git diff --name-only --diff-filter=A "$before" "$after" -- 'apps/web/drizzle/*.sql' || true)"
  if [ -n "$new_sql" ]; then
    echo >&2
    echo "==> This release adds migrations" >&2
    echo "$new_sql" | sed 's/^/      /' >&2
    echo >&2
    echo "    Apply them before the new code starts. \`db:push\` below generates" >&2
    echo "    schema changes but not data changes, so a migration that has to" >&2
    echo "    de-duplicate rows first, or add an enum value and use it, will" >&2
    echo "    fail through push and has to go through psql:" >&2
    echo >&2
    # One self-contained command per migration, and deliberately so. This block
    # used to print a DB= assignment followed by psql lines using it; only the
    # psql lines got copied, DB was empty, and psql fell back to a local socket
    # on a machine whose database is remote - reporting "is the server running
    # locally?", which points nowhere near the actual mistake.
    for f in $new_sql; do
      echo "      bash scripts/psql.sh -f $f" >&2
    done
    echo >&2
    echo "    Then run this script again. The pull is already done, so it will" >&2
    fail "  find nothing new and carry straight on to the build."
  fi
fi

# ---------------------------------------------------------------------------
# Build and restart.
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# Prove it came back, rather than assuming a restart means a working app.
# ---------------------------------------------------------------------------

echo "==> Checking health"
health=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  health="$(curl -fsS "localhost:${APP_PORT}/api/health" 2>/dev/null || true)"
  case "$health" in *'"ok":true'*) break ;; esac
done
case "$health" in
  *'"ok":true'*)
    echo "    $health"
    ;;
  "")
    echo "    No response from localhost:${APP_PORT} after 20s." >&2
    echo "    The processes restarted but the app is not answering:" >&2
    pm2 logs "${PM2_APPS%% *}" --lines 30 --nostream >&2 || true
    fail "Deploy finished but the app is down."
    ;;
  *)
    echo "    $health" >&2
    fail "Health check reported a problem."
    ;;
esac

echo
echo "==> Deployed ${after:0:7}"
pm2 list
