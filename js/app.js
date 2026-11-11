/* Probst's Posse — renders the draft tracker from data/*.json.
   Scoring lives here so the JSON only ever stores facts about the season. */

(function () {
  "use strict";

  const REFRESH_MS = 5 * 60 * 1000;
  // While the episode-night watcher is running, new statuses can land at any minute
  const LIVE_REFRESH_MS = 60 * 1000;
  // GitHub allows 60 anonymous API calls an hour per network, shared by everyone on it
  const SYNC_POLL_MS = 5 * 60 * 1000;
  // An ordinary check takes a minute or two; a sync run older than this is the watcher
  const WATCHER_AGE_MS = 4 * 60 * 1000;
  const RUNS_API = "https://api.github.com/repos/dylanl280/probstsposse/actions/workflows/site.yml/runs";

  const STATUS = {
    active: { label: "Still in the game", tone: "active", out: false },
    voted_out: { label: "Voted out", tone: "out", out: true, spoken: true },
    jury: { label: "Jury member", tone: "out", out: true, spoken: true },
    medevac: { label: "Medically evacuated", tone: "warn", out: true },
    quit: { label: "Quit", tone: "warn", out: true },
    finalist: { label: "Final three", tone: "gold", out: false },
    winner: { label: "Sole Survivor", tone: "gold", out: false },
  };

  const TRIBE_COLORS = {
    yellow: { color: "var(--toka-yellow)", ink: "#1d1a0a" },
    purple: { color: "var(--savu-purple)", ink: "#fff" },
    pink: { color: "var(--dina-pink)", ink: "#fff" },
    blue: { color: "var(--tovuto-blue)", ink: "#fff" },
  };

  let state = { cast: null, draft: null, castFilter: "all", lastUpdated: undefined, live: false };

  // js/fx.js is optional polish: if it failed to load, everything still renders
  const FX = window.PosseFX || null;
  if (!FX) document.documentElement.classList.remove("fx");
  // Set to " reveal" during a full render, so fresh cards animate in as they scroll into view
  let reveal = "";

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[ch]);
  }

  function statusOf(c) {
    return STATUS[c.status] || STATUS.active;
  }

  function tribeStyle(tribeId) {
    const tribe = state.cast.tribes[tribeId] || {};
    const t = TRIBE_COLORS[tribe.color] || { color: "var(--merge-teal)", ink: "#fff" };
    return `--tribe-color:${t.color};--tribe-ink:${t.ink}`;
  }

  function tribeName(tribeId) {
    return (state.cast.tribes[tribeId] || {}).name || tribeId;
  }

  function tribeTag(tribeId) {
    return `<span class="tribe-tag" style="${tribeStyle(tribeId)}">${esc(tribeName(tribeId))}</span>`;
  }

  /** How many castaways this one outlasted: higher = finished higher. Drives the tiebreakers. */
  function longevity(c) {
    const n = state.cast.castaways.length;
    if (c.status === "winner") return n - 1;
    if (c.status === "finalist") {
      // The jury vote separates the losing finalists: the runner-up beats the
      // 2nd runner-up. A tied vote ("co-runner-up") leaves the two level.
      const f = (c.finish || "").toLowerCase();
      if (/\b(2nd|second|3rd|third)\b/.test(f)) return n - 3;
      if (/\bco-?\s*runner/.test(f)) return n - 2.5;
      return n - 2;
    }
    if (!statusOf(c).out) return n - 1;
    return (c.bootOrder || 1) - 1;
  }

  function seasonOver() {
    return state.cast.castaways.some((c) => c.status === "winner");
  }

  function pickedBy(castawayId) {
    return state.draft.players.filter((p) => p.finalThree.includes(castawayId));
  }

  function statusPill(c) {
    const s = statusOf(c);
    return `<span class="status status--${s.tone}">${esc(s.label)}</span>`;
  }

  function spokenLine(c) {
    return statusOf(c).spoken
      ? `<div class="castaway__spoken">${torchSvg(false)}<span>The tribe has spoken.</span></div>` : "";
  }

  function outDetail(c) {
    if (!statusOf(c).out) return "";
    const bits = [];
    if (c.episodeOut) bits.push(`Episode ${c.episodeOut}`);
    if (c.day) bits.push(`Day ${c.day}`);
    return bits.join(" · ");
  }

  /** Photo + name + status block used across the page. */
  function castawayBlock(c, { meta = "", showTribe = false, photoOnly = false } = {}) {
    const s = statusOf(c);
    const classes = ["castaway"];
    if (s.out) classes.push("is-out");
    if (c.status === "winner") classes.push("is-winner");
    const badge = s.out && outDetail(c)
      ? `<span class="castaway__badge">${esc(outDetail(c))}</span>` : "";
    const photo = `
        <div class="castaway__photo">
          <img src="${esc(c.photo)}" alt="${esc(c.name)}" loading="lazy" width="300" height="300">
          ${badge}
        </div>`;
    if (photoOnly) {
      return `<div class="${classes.join(" ")}" style="${tribeStyle(c.tribe)}">${photo}</div>`;
    }
    return `
      <div class="${classes.join(" ")}" style="${tribeStyle(c.tribe)}">
        ${photo}
        <div class="castaway__name">${esc(c.shortName)}</div>
        ${statusPill(c)}
        ${spokenLine(c)}
        ${showTribe ? tribeTag(c.tribe) : ""}
        ${meta ? `<div class="castaway__meta">${meta}</div>` : ""}
      </div>`;
  }

  /** Tiki torch: flame on top when lit, a wisp of smoke when snuffed.
      `index` is its place in a row of torches, so they light one after another. */
  function torchSvg(lit, index = 0) {
    const top = lit
      ? `<g class="torch__fire"><g class="torch__flame">
           <path class="torch__flame-outer" d="M10 1C13.8 5.6 15.6 8.6 15.1 11.6C14.6 14.4 12.6 15.8 10 15.8S5.4 14.4 4.9 11.6C4.5 9 6.6 7.2 7.6 4.6C8.3 6.4 9.2 7 9.8 7.3C10.4 5.4 10.3 3.2 10 1Z"/>
           <path class="torch__flame-inner" d="M10 7.6C11.8 9.8 12.7 11.2 12.4 12.8C12.1 14.2 11.2 14.9 10 14.9S7.9 14.2 7.6 12.8C7.3 11.2 8.6 9.8 10 7.6Z"/>
         </g></g>`
      : `<path class="torch__smoke" d="M10 14.5C8.2 12.4 11.8 10.6 10 8.2C8.6 6.4 11.2 4.6 10.2 2.2"/>`;
    return `<svg class="torch${lit ? "" : " is-snuffed"}" viewBox="0 0 20 44" style="--t:${index}" aria-hidden="true">
      ${top}
      <path class="torch__head" d="M4.2 15.4H15.8L13.8 23.6H6.2Z"/>
      <path class="torch__wrap" d="M4.9 18.2H15.1M5.6 21H14.4M7.4 15.6L9 23.4M12.6 15.6L11 23.4"/>
      <path class="torch__pole" d="M8.6 23.4H11.4L10.8 43.4H9.2Z"/>
    </svg>`;
  }

  function torches(alive) {
    let html = `<span class="torches" role="img" aria-label="${alive} of 3 picks still in">`;
    for (let i = 0; i < 3; i++) html += torchSvg(i < alive, i);
    return html + `<span class="torches__label" aria-hidden="true">${alive}/3</span></span>`;
  }

  // ---------- scoring ----------
  function computeStandings() {
    const byId = Object.fromEntries(state.cast.castaways.map((c) => [c.id, c]));
    const over = seasonOver();

    const rows = state.draft.players.map((p) => {
      const picks = p.finalThree.map((id) => byId[id]).filter(Boolean);
      const winnerPick = byId[p.winner];
      return {
        player: p,
        picks,
        winnerPick,
        alive: picks.filter((c) => !statusOf(c).out).length,
        points: picks.filter((c) => c.status === "finalist" || c.status === "winner").length,
        champion: winnerPick && winnerPick.status === "winner",
        tiebreak: winnerPick ? longevity(winnerPick) : 0,
        // Second tiebreaker: how deep all three picks went, combined
        depth: picks.reduce((sum, c) => sum + longevity(c), 0),
      };
    });

    const anyChampion = rows.some((r) => r.champion);
    const keys = (r) => over
      ? [anyChampion && r.champion ? 1 : 0, r.points, r.tiebreak, r.depth]
      : [r.alive, r.tiebreak];

    rows.sort((a, b) => {
      const ka = keys(a), kb = keys(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
      return a.player.name.localeCompare(b.player.name);
    });

    // Equal keys share a rank: mid-season while winner picks are still alive,
    // or after the finale only if every tiebreaker comes out dead level
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      r.rank = prev && keys(prev).join() === keys(r).join() ? prev.rank : i + 1;
    });
    rows.forEach((r) => {
      r.tied = rows.filter((o) => o.rank === r.rank).length > 1;
    });
    if (over && !anyChampion && rows.length) rows[0].champion = rows[0].rank === 1 && !rows[0].tied;
    return rows;
  }

  function rankLabel(r) {
    if (r.champion && seasonOver()) return "🏆 Champion";
    return `${r.tied ? "T-" : ""}${r.rank}`;
  }

  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ---------- renderers ----------
  /** `animate` replays the entrance and counts the numbers up (full renders only). */
  function renderHero(animate) {
    const cast = state.cast.castaways;
    const remaining = cast.filter((c) => !statusOf(c).out).length;
    const activeTribes = new Set(cast.filter((c) => !statusOf(c).out).map((c) => c.tribe)).size;
    // Fall back to the last data change if GitHub's API is unreachable
    const checked = state.lastChecked || state.cast.lastUpdated;
    // Screen readers get the real number; only the visible copy counts up
    const count = (n) => `<span class="visually-hidden">${n}</span><span data-count="${n}" aria-hidden="true">${n}</span>`;
    const sole = cast.find((c) => c.status === "winner");
    const champion = (state.rows || []).find((r) => r.champion);
    const stats = [
      [count(state.cast.episodesAired), "Episodes aired"],
      // Once the season is decided, the headline is who won it and who won the draft
      ...(sole ? [
        [esc(sole.shortName), "Sole Survivor"],
        [champion ? esc(champion.player.name) : "Tied", "Draft champion"],
      ] : [
        [`${count(remaining)}<small style="font-size:.55em;opacity:.7"> / ${cast.length}</small>`, "Castaways left"],
        [count(activeTribes), activeTribes === 1 ? "Tribe (merged)" : "Tribes"],
      ]),
      state.live
        ? [`<span class="live-dot"></span>Live`, "Checking every 5 min"]
        : [esc(formatTime(checked)), "Last checked"],
    ];
    const box = $("hero-stats");
    box.classList.toggle("is-entering", Boolean(animate));
    box.innerHTML = stats.map(([v, l], i) =>
      `<div class="stat" style="--i:${i}"><div class="stat__value">${v}</div><div class="stat__label">${l}</div></div>`).join("");
    if (animate && FX) {
      box.querySelectorAll("[data-count]").forEach((el, i) => FX.countUp(el, 300 + i * 80));
    }
    $("footer-updated").innerHTML = `Statuses sync automatically from <a href="https://en.wikipedia.org/wiki/Survivor_51" rel="noopener">Wikipedia</a>`
      + (state.cast.lastUpdated ? ` · last change ${esc(formatTime(state.cast.lastUpdated))}` : "") + ".";
  }

  function formatTime(iso) {
    return iso
      ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "—";
  }

  function renderStandings(rows) {
    const over = seasonOver();
    $("standings-lede").textContent = over
      ? "Final results: champion first, then points, then whose winner pick finished higher."
      : "Ranked by picks still in the game, then by whose winner pick has lasted longest. Points are awarded at the finale.";

    const body = rows.map((r, i) => {
      const w = r.winnerPick;
      const wOut = statusOf(w).out;
      const outcome = over
        ? `<span class="status status--${r.champion ? "gold" : "active"}">${r.points} pt${r.points === 1 ? "" : "s"}</span>`
        : wOut
          ? `<span class="status status--out">Playing for 2nd</span>`
          : `<span class="status status--active">Winner pick alive</span>`;
      return `
        <tr${r.champion && over ? ` class="is-champion"` : ""} style="--d:${i * 60}ms">
          <td class="rank rank--${r.rank}">${esc(rankLabel(r))}</td>
          <td><span class="player-name">${esc(r.player.name)}</span></td>
          <td>
            <span class="mini-pick${wOut ? " is-out" : ""}" style="${tribeStyle(w.tribe)}">
              <img src="${esc(w.photo)}" alt="" width="40" height="40">
              <span>${esc(w.shortName)}</span>
            </span>
          </td>
          <td>${torches(r.alive)}</td>
          <td class="${over ? "" : "col-hide-sm"}">${outcome}</td>
        </tr>`;
    }).join("");

    $("standings-table").innerHTML = `
      <table class="standings__table">
        <thead><tr>
          <th scope="col">Rank</th>
          <th scope="col">Player</th>
          <th scope="col">Winner pick</th>
          <th scope="col">Picks alive</th>
          <th scope="col" class="${over ? "" : "col-hide-sm"}">${over ? "Points" : "Status"}</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  }

  function renderDraft(rows) {
    const over = seasonOver();
    $("draft-grid").innerHTML = rows.map((r) => {
      const w = r.winnerPick;
      const wOut = statusOf(w).out;
      const others = r.picks.filter((c) => c.id !== w.id);
      const f3 = [w, ...others].map((c) => castawayBlock(c, {
        meta: c.id === w.id ? "★ Winner pick" : "",
      })).join("");
      const egg = r.player.easterEgg
        ? `<figure class="easter-egg" aria-hidden="true">
             <img src="${esc(r.player.easterEgg)}" alt="" loading="lazy" width="600" height="800">
             <figcaption>${esc(r.player.name)}</figcaption>
           </figure>`
        : "";
      return `
        <article class="card player-card${egg ? " has-egg" : ""}${r.champion && over ? " is-champion" : ""}${reveal}">
          ${egg}
          <div class="player-card__head">
            <h3 class="player-card__name">${esc(r.player.name)}</h3>
            <span class="player-card__rank">${r.champion && over ? "🏆 Champion" : `${r.tied ? "Tied " : ""}${ordinal(r.rank)} place`}</span>
          </div>
          <div class="player-card__body">
            <div>
              <div class="label">Winner pick</div>
              <div class="winner-pick${wOut ? " is-out" : ""}">
                ${castawayBlock(w, { photoOnly: true })}
                <div class="winner-pick__info">
                  <div class="winner-pick__name">${esc(w.shortName)}</div>
                  ${statusPill(w)}
                  ${spokenLine(w)}
                  ${tribeTag(w.tribe)}
                  <div class="castaway__meta">${esc(w.occupation)} · ${esc(w.hometown)}</div>
                  ${wOut ? `<div class="castaway__meta">${esc(w.finish || statusOf(w).label)}${outDetail(w) ? " · " + esc(outDetail(w)) : ""}</div>` : ""}
                </div>
              </div>
            </div>
            <div>
              <div class="label">Final three</div>
              <div class="f3-grid">${f3}</div>
            </div>
          </div>
          <div class="player-card__foot">
            <span>${r.alive} of 3 picks still in</span>
            <span>${over ? `<strong>${r.points}</strong> pt${r.points === 1 ? "" : "s"}` : torches(r.alive)}</span>
          </div>
        </article>`;
    }).join("");
  }

  function renderTribes() {
    const cast = state.cast.castaways;
    const order = [];
    cast.forEach((c) => { if (!statusOf(c).out && !order.includes(c.tribe)) order.push(c.tribe); });

    $("tribes-grid").innerHTML = order.map((tribeId) => {
      const tribe = state.cast.tribes[tribeId] || {};
      const members = cast.filter((c) => c.tribe === tribeId);
      const active = members.filter((c) => !statusOf(c).out);
      const gone = members.filter((c) => statusOf(c).out).sort((a, b) => a.bootOrder - b.bootOrder);
      const colorClass = tribe.color ? ` tribe--${esc(tribe.color)}` : "";
      return `
        <article class="card tribe${colorClass}${reveal}" style="${tribe.color ? "" : tribeStyle(tribeId)}">
          <div class="tribe__head">
            <h3 class="tribe__title">${esc(tribeName(tribeId))}</h3>
            <div class="tribe__meta">${active.length} remaining${gone.length ? ` · ${gone.length} out` : ""}${tribe.meaning ? ` · ${esc(tribe.meaning)}` : ""}</div>
          </div>
          <div class="tribe__body">
            ${[...active, ...gone].map((c) => castawayBlock(c)).join("")}
          </div>
        </article>`;
    }).join("");
  }

  function renderBootOrder() {
    const out = state.cast.castaways
      .filter((c) => statusOf(c).out)
      .sort((a, b) => a.bootOrder - b.bootOrder);
    $("boot-list").innerHTML = out.length
      ? out.map((c) => `
          <li class="card boot${reveal}">
            <span class="boot__num">${c.bootOrder}</span>
            <img class="boot__photo" src="${esc(c.photo)}" alt="" width="56" height="56">
            <div>
              <div class="boot__name">${esc(c.shortName)}</div>
              <div class="boot__detail">${esc(c.finish || statusOf(c).label)}</div>
              <div class="boot__detail">${esc(outDetail(c))} · ${esc(tribeName(c.tribe))}</div>
            </div>
          </li>`).join("")
      : `<li class="card empty">No one has been voted out yet.</li>`;
  }

  function renderCastFilters() {
    const tribes = [...new Set(state.cast.castaways.map((c) => c.originalTribe))];
    const filters = [["all", "All"], ["in", "Still in"], ["out", "Out"],
      ...tribes.map((t) => [`tribe:${t}`, tribeName(t)])];
    $("cast-filters").innerHTML = filters.map(([key, label]) =>
      `<button class="chip" type="button" data-filter="${esc(key)}" aria-pressed="${state.castFilter === key}">${esc(label)}</button>`).join("");
  }

  function renderCast() {
    const f = state.castFilter;
    const list = state.cast.castaways.filter((c) => {
      if (f === "in") return !statusOf(c).out;
      if (f === "out") return statusOf(c).out;
      if (f.startsWith("tribe:")) return c.originalTribe === f.slice(6) || c.tribe === f.slice(6);
      return true;
    });
    $("cast-grid").innerHTML = list.map((c) => {
      const drafted = pickedBy(c.id);
      const draftLine = drafted.length
        ? `Drafted by ${drafted.map((p) => esc(p.name) + (p.winner === c.id ? " ★" : "")).join(", ")}`
        : "Undrafted";
      return `<div class="card cast-card${reveal}" style="--vt:cast-${esc(c.id)}">${castawayBlock(c, {
        showTribe: true,
        meta: `${c.age} · ${esc(c.occupation)}<br>${esc(c.hometown)}<br><em>${draftLine}</em>`,
      })}</div>`;
    }).join("");
  }

  function renderAll() {
    const rows = computeStandings();
    state.rows = rows;
    // Only a full render marks cards for the scroll reveal: on first load, and
    // again whenever new statuses land, so the board visibly refreshes
    reveal = FX ? " reveal" : "";
    renderHero(true);
    renderStandings(rows);
    renderDraft(rows);
    renderTribes();
    renderBootOrder();
    renderCastFilters();
    renderCast();
    reveal = "";
    if (FX) FX.scan();
    celebrate(rows);
  }

  /** Confetti for the draft champion, once per visit. */
  function celebrate(rows) {
    if (!FX || state.celebrated || !seasonOver() || !rows.some((r) => r.champion)) return;
    state.celebrated = true;
    setTimeout(FX.confetti, 900);
  }

  // ---------- data loading ----------
  async function fetchJson(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  /** What the Wikipedia sync is up to, from GitHub's public API: when it last
      finished a check, and whether the episode-night watcher is running now. */
  async function fetchSyncStatus() {
    try {
      const res = await fetch(`${RUNS_API}?per_page=30`, { cache: "no-store" });
      if (!res.ok) return null;
      const { workflow_runs: runs = [] } = await res.json();
      const syncs = runs.filter((r) => r.event === "schedule" || r.event === "workflow_dispatch");
      const live = syncs.some((r) => r.status === "in_progress"
        && Date.now() - Date.parse(r.run_started_at || r.created_at) > WATCHER_AGE_MS);
      const done = syncs.find((r) => r.status === "completed" && r.conclusion === "success");
      return { live, checked: done ? done.updated_at : null };
    } catch (e) {
      return null;
    }
  }

  let syncCache = null, syncAt = 0;

  /** fetchSyncStatus, rationed to stay well inside GitHub's anonymous rate limit. */
  async function syncStatus() {
    if (syncAt && Date.now() - syncAt < SYNC_POLL_MS) return syncCache;
    syncAt = Date.now();
    const fresh = await fetchSyncStatus();
    if (fresh) syncCache = { ...fresh, at: syncAt };
    // After a long stretch without news, stop claiming the watcher is live
    else if (syncCache && syncAt - syncCache.at > 4 * SYNC_POLL_MS) syncCache = { ...syncCache, live: false };
    return syncCache;
  }

  let loading = false, timer = 0;

  async function load() {
    if (loading) return;
    // Nobody is looking at a hidden tab: it catches up the moment it is shown again
    if (document.hidden && state.cast) return;
    loading = true;
    try {
      const [cast, draft, sync] = await Promise.all([
        fetchJson("data/castaways.json"), fetchJson("data/draft.json"), syncStatus(),
      ]);
      const changed = cast.lastUpdated !== state.lastUpdated || !state.draft;
      const live = sync ? sync.live : state.live;
      const lastChecked = (sync && sync.checked) || state.lastChecked;
      const heroChanged = live !== state.live || lastChecked !== state.lastChecked;
      state.cast = cast;
      state.draft = draft;
      state.lastUpdated = cast.lastUpdated;
      state.live = live;
      state.lastChecked = lastChecked;
      $("error").innerHTML = "";
      if (changed) renderAll();
      else if (heroChanged) renderHero(false);
    } catch (err) {
      console.error(err);
      if (!state.cast) {
        $("error").innerHTML = `<div class="notice">Couldn't load the season data. Try refreshing the page.</div>`;
      }
    } finally {
      loading = false;
      // Check back sooner while the watcher is live
      clearTimeout(timer);
      timer = setTimeout(load, state.live ? LIVE_REFRESH_MS : REFRESH_MS);
    }
  }

  // ---------- interactions ----------
  // Easter eggs: hover shows them on desktop (CSS); on touch screens a tap toggles them
  document.addEventListener("click", (e) => {
    if (matchMedia("(hover: hover)").matches) return;
    const card = e.target.closest(".player-card.has-egg");
    document.querySelectorAll(".player-card.egg-open").forEach((c) => {
      if (c !== card) c.classList.remove("egg-open");
    });
    if (card) card.classList.toggle("egg-open");
  });

  $("cast-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    if (btn.dataset.filter === state.castFilter) return;
    state.castFilter = btn.dataset.filter;
    // Update the chips in place, so keyboard focus stays on the one just pressed
    $("cast-filters").querySelectorAll("[data-filter]").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.filter === state.castFilter));
    });
    // Where the browser supports it, the cards glide to their new places
    if (FX) FX.transition(renderCast, "vt-cast");
    else renderCast();
  });

  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }

  try { applyTheme(localStorage.getItem("theme")); } catch (e) { /* storage unavailable */ }

  $("theme-toggle").addEventListener("click", (e) => {
    const current = document.documentElement.dataset.theme
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", next); } catch (err) { /* storage unavailable */ }
    const apply = () => applyTheme(next);
    const transition = FX ? FX.transition(apply, "vt-theme") : (apply(), null);
    if (!transition) return;
    // The new theme spreads out from the toggle in a growing circle
    const box = e.currentTarget.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 550, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    }).catch(() => { /* transition skipped */ });
  });

  load();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") load();
  });
  // Pages restored from the back/forward cache pick up where they left off
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) load();
  });
})();
