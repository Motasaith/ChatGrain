#!/usr/bin/env bash
#
# psql, pointed at this installation's database.
#
#   bash scripts/psql.sh -f apps/web/drizzle/0030_admin_sessions.sql
#   bash scripts/psql.sh -c '\d workspaces'
#
# This exists because of a deploy that stalled on it. The deploy script printed
# two lines to run - one setting DB from the env file, one calling psql with it -
# and only the second got copied. With DB unset, `psql "$DB"` quietly falls back
# to a local socket, so the error was "is the server running locally?" on a
# machine whose database is not local and never was. Nothing about that message
# points at the real cause.
#
# One self-contained command cannot be half-copied.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-apps/web/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo >&2 "    No env file at $ENV_FILE."
  echo >&2 "    Set ENV_FILE=path/to/.env if it lives somewhere else."
  exit 1
fi

# The value only, with surrounding quotes stripped. Octal escapes for " and '
# so this line does not have to nest quotes inside quotes - which is exactly
# what made the printed version painful to copy correctly.
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | head -1 | tr -d '\042\047')"

if [ -z "$DATABASE_URL" ]; then
  echo >&2 "    No DATABASE_URL in $ENV_FILE."
  exit 1
fi

# Guards against the failure this script was written for: a value that is not a
# connection string at all still reaches psql, which then tries a local socket
# and reports something unrelated to what is wrong.
case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *)
    echo >&2 "    DATABASE_URL in $ENV_FILE does not look like a connection string."
    echo >&2 "    It starts: ${DATABASE_URL:0:12}…"
    exit 1
    ;;
esac

command -v psql >/dev/null 2>&1 || {
  echo >&2 "    psql is not on PATH. On Debian or Ubuntu: apt install postgresql-client"
  exit 1
}

# Host and database only. The password is in this string and must not be echoed
# into a terminal that is likely being pasted into a chat window.
echo "==> psql ${DATABASE_URL#*@}" | sed 's/?.*//'

exec psql "$DATABASE_URL" "$@"
