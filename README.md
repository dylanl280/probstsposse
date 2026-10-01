# Probst's Posse — Survivor 51 Draft Tracker

Live at **https://dylanl280.github.io/probstsposse/**

A static site (no build step, no database) that tracks our Survivor 51 draft.

## How it works

| File | What it holds |
|---|---|
| `data/draft.json` | Each player's winner pick and final three |
| `data/castaways.json` | Bios, photos, tribes and live status for all 21 castaways |
| `js/app.js` | Calculates standings and renders the page |
| `css/global.css` | Design tokens (buff colors) and all styles |
| `scripts/update_status.py` | Pulls statuses from the Survivor 51 Wikipedia page |
| `.github/workflows/site.yml` | Runs the sync on a schedule and deploys to GitHub Pages |

The sync runs every 30 minutes on Wednesday nights after the episode, plus every 6 hours.
If anything changed it commits `data/castaways.json` and redeploys. Open pages refresh their data every 5 minutes.

## Fixing a status by hand

If Wikipedia is wrong (or slow), edit `data/castaways.json` on GitHub and set
`"manualOverride": true` on that castaway so the sync won't overwrite your fix.

Statuses: `active`, `voted_out`, `jury`, `medevac`, `quit`, `finalist`, `winner`.

To force a sync now: **Actions → Sync statuses & deploy → Run workflow**.

## Scoring

- Your winner pick wins the season → you win the draft.
- 1 point for each of your three picks who makes the final three.
- Tiebreaker: whoever's winner pick lasted longer.
- Nobody picked the winner → most points is champion.
