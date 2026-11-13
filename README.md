# Probst's Posse — Survivor 51 Draft Tracker

Live at **https://dylanl280.github.io/probstsposse/**

A static site (no build step, no database) that tracks our Survivor 51 draft.

## How it works

| File | What it holds |
|---|---|
| `data/draft.json` | Each player's winner pick and final three |
| `data/castaways.json` | Bios, photos, tribes and live status for all 21 castaways |
| `js/app.js` | Calculates standings and renders the page |
| `js/fx.js` | Animations. Optional: the page works without it, and it respects "reduce motion" |
| `js/council.js` | The torch-snuffing ceremony for each elimination, and its optional sound. Optional, like `fx.js` |
| `css/global.css` | Design tokens (Survivor palette, buff colors, dark and Day themes) and the main styles |
| `css/council.css` | Textures, the Boot Order "Tribal Council" band and the ceremony styles |
| `scripts/update_status.py` | Pulls statuses from the Survivor 51 Wikipedia page |
| `scripts/sync.sh` | Decides how to run the scraper: once, or as the episode-night watcher |
| `.github/workflows/site.yml` | Starts the sync on a schedule and deploys to GitHub Pages |

Preview links: `?theme=light` or `?theme=dark` shows a theme without saving it, and
`?council=latest` (or `?council=<castaway id>`) replays a torch-snuffing ceremony.

## Keeping statuses current

GitHub starts scheduled workflows late, often by hours, and skips most of them.
So the schedule is only a set of chances to start, and `scripts/sync.sh` does the timing:

- **Most of the week** an hourly run checks Wikipedia once and exits.
- **On Wednesdays** the first run to start (any time from 00:00 UTC, which is 7pm Eastern
  on Tuesday in winter) becomes a *watcher*. It stays alive and re-checks Wikipedia every
  5 minutes until Thursday 06:00 UTC (1am Eastern), handing over to a fresh run before
  GitHub's 6-hour job limit. Only one watcher runs at a time. Starting that early means a
  single scheduled run on Wednesday is enough to cover the episode.

When a check finds a change it commits `data/castaways.json` and requests a deploy.
Open pages refresh their data every 5 minutes, or every minute while the watcher is
running (the page header shows "Live").

## Fixing a status by hand

If Wikipedia is wrong (or slow), edit `data/castaways.json` on GitHub and set
`"manualOverride": true` on that castaway so the sync won't overwrite your fix.

Statuses: `active`, `voted_out`, `jury`, `medevac`, `quit`, `finalist`, `winner`.

To force a sync now: **Actions → Sync statuses & deploy → Run workflow**, and pick a mode:

- `auto` (default): check once now, or become the watcher if it is Wednesday (UTC).
- `watch`: keep checking every 5 minutes for the number of minutes you enter. Use it for
  a finale or a special that airs on another night.
- `deploy`: redeploy the site without checking Wikipedia.

## Scoring

- Your winner pick wins the season → you win the draft.
- 1 point for each of your three picks who makes the final three.
- Tiebreaker: whoever's winner pick lasted longer. At the finale the runner-up beats the 2nd runner-up (jury votes).
- Still tied (the jury tied the two losing finalists): the better combined finish of all three picks.
- Nobody picked the winner → most points is champion.
