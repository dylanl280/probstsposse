#!/usr/bin/env bash
# Runs the Wikipedia scraper for the "sync" job in .github/workflows/site.yml.
#
# GitHub starts scheduled workflows late (often by hours) and skips many of them,
# so the schedule alone can't keep the site current on episode night. Instead:
#   - Most of the week a run syncs once and exits.
#   - A run that starts inside the episode window (Wednesday night US time) turns
#     into a "watcher": it stays alive and re-checks Wikipedia every few minutes
#     until the window closes. Only one watcher runs at a time.
#
# MODE=auto (default) picks between the two; MODE=watch watches for WATCH_MINUTES.
set -euo pipefail

MODE="${MODE:-auto}"
WATCH_MINUTES="${WATCH_MINUTES:-180}"
INTERVAL="${INTERVAL:-300}"        # seconds between checks while watching
MAX_RUNTIME=$((340 * 60))          # hand over before GitHub's 6-hour job limit
WORKFLOW="site.yml"
PYTHON="${PYTHON:-python3}"

# Episode window in UTC: Wednesday 20:00 to Thursday 06:00
# (3pm-1am Eastern in winter; the show airs 8pm Eastern on Wednesdays).
WINDOW_OPENS_HOUR=20
WINDOW_CLOSES_HOUR=6

start=$(date -u +%s)
watch_until=0
checks_ok=0

if [ "$MODE" = "watch" ]; then
  watch_until=$((start + WATCH_MINUTES * 60))
else
  dow=$(date -u +%u)               # 3 = Wednesday, 4 = Thursday
  hour=$((10#$(date -u +%H)))
  if [ "$dow" = 3 ] && [ "$hour" -ge "$WINDOW_OPENS_HOUR" ]; then
    watch_until=$(date -u -d "tomorrow 0$WINDOW_CLOSES_HOUR:00" +%s)
  elif [ "$dow" = 4 ] && [ "$hour" -lt "$WINDOW_CLOSES_HOUR" ]; then
    watch_until=$(date -u -d "today 0$WINDOW_CLOSES_HOUR:00" +%s)
  fi
fi

# Counts other sync runs that have been going for over 3 minutes. A one-off sync
# or a deploy finishes in well under a minute, so anything older is a watcher.
# $1 is an extra jq condition.
watchers() {
  gh run list --workflow "$WORKFLOW" --status in_progress --limit 20 --json databaseId,event,createdAt --jq '[.[] | select((.databaseId | tostring) != env.GITHUB_RUN_ID and .event != "push" and (now - (.createdAt | fromdateiso8601)) > 180 and '"$1"')] | length' || echo 0
}

sync_once() {
  git pull --quiet --rebase origin main || return 1
  if ! "$PYTHON" scripts/update_status.py; then
    git checkout --quiet -- data/castaways.json
    return 1
  fi
  checks_ok=$((checks_ok + 1))
  if git diff --quiet -- data/castaways.json; then
    return 0
  fi
  git add data/castaways.json
  git commit --quiet -m "Update castaway statuses from Wikipedia"
  # If someone else pushed in the meantime, drop this commit; the next check redoes it cleanly
  git push --quiet origin HEAD:main || { git reset --quiet --hard HEAD~1; return 1; }
  # A push made with the workflow's own token doesn't start a new run, so ask for the deploy
  gh workflow run "$WORKFLOW" --ref main -f mode=deploy
  echo "Statuses changed: committed and requested a deploy."
}

git config user.name "probstsposse-bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if [ "$watch_until" -le "$start" ]; then
  sync_once
  exit 0
fi

if [ "$MODE" != "watch" ] && [ "$(watchers true)" != "0" ]; then
  echo "A watcher is already on duty; nothing to do."
  exit 0
fi

echo "Watching Wikipedia every $((INTERVAL / 60)) min until $(date -u -d "@$watch_until" '+%a %H:%M UTC')."
while :; do
  sync_once || echo "::warning::Wikipedia check failed; trying again on the next pass"
  now=$(date -u +%s)
  if [ "$now" -ge "$watch_until" ]; then
    break
  fi
  if [ $((now - start)) -ge "$MAX_RUNTIME" ]; then
    left=$(( (watch_until - now + 59) / 60 ))
    gh workflow run "$WORKFLOW" --ref main -f mode=watch -f minutes="$left"
    echo "Handing over to a fresh run for the remaining $left minutes."
    break
  fi
  sleep "$INTERVAL"
  # If two watchers ever start at once, the newer one steps aside
  if [ "$(watchers '.databaseId < (env.GITHUB_RUN_ID | tonumber)')" != "0" ]; then
    echo "An earlier watcher is already on duty; stepping aside."
    break
  fi
done

if [ "$checks_ok" = 0 ]; then
  echo "::error::Every Wikipedia check in this run failed."
  exit 1
fi
