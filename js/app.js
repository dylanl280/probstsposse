/* Probst's Posse — renders the draft tracker from data/*.json.
   Scoring lives here so the JSON only ever stores facts about the season. */

(function () {
  "use strict";

  const REFRESH_MS = 5 * 60 * 1000;

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
  };

  let state = { cast: null, draft: null, castFilter: "all", lastUpdated: undefined };

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

  /** Higher = lasted longer. Used for the tiebreaker. */
  function longevity(c) {
    if (c.status === "winner") return 10000;
    if (c.status === "finalist") return 9000;
    if (!statusOf(c).out) return 5000;
    return c.bootOrder || 0;
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
        ${s.spoken ? `<div class="castaway__spoken">The tribe has spoken.</div>` : ""}
        ${showTribe ? tribeTag(c.tribe) : ""}
        ${meta ? `<div class="castaway__meta">${meta}</div>` : ""}
      </div>`;
  }

  function torches(alive) {
    let html = `<span class="torches" aria-label="${alive} of 3 picks still in">`;
    for (let i = 0; i < 3; i++) {
      html += `<span class="torch${i < alive ? "" : " is-snuffed"}"></span>`;
    }
    return html + `<span class="torches__label">${alive}/3</span></span>`;
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
      };
    });

    const anyChampion = rows.some((r) => r.champion);
    const keys = (r) => over
      ? [anyChampion && r.champion ? 1 : 0, r.points, r.tiebreak]
      : [r.alive, r.tiebreak];

    rows.sort((a, b) => {
      const ka = keys(a), kb = keys(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
      return a.player.name.localeCompare(b.player.name);
    });

    // Equal keys share a rank (only possible mid-season while winner picks are all alive)
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
  function renderHero() {
    const cast = state.cast.castaways;
    const remaining = cast.filter((c) => !statusOf(c).out).length;
    const activeTribes = new Set(cast.filter((c) => !statusOf(c).out).map((c) => c.tribe)).size;
    const updated = state.cast.lastUpdated
      ? new Date(state.cast.lastUpdated).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "—";
    const stats = [
      [state.cast.episodesAired, "Episodes aired"],
      [`${remaining}<small style="font-size:.55em;opacity:.7"> / ${cast.length}</small>`, "Castaways left"],
      [activeTribes, activeTribes === 1 ? "Tribe (merged)" : "Tribes"],
      [esc(updated), "Last update"],
    ];
    $("hero-stats").innerHTML = stats.map(([v, l]) =>
      `<div class="stat"><div class="stat__value">${v}</div><div class="stat__label">${l}</div></div>`).join("");
  }

  function renderStandings(rows) {
    const over = seasonOver();
    $("standings-lede").textContent = over
      ? "Final results: champion first, then points, then whose winner pick lasted longest."
      : "Ranked by picks still in the game, then by whose winner pick has lasted longest. Points are awarded at the finale.";

    const body = rows.map((r) => {
      const w = r.winnerPick;
      const wOut = statusOf(w).out;
      const outcome = over
        ? `<span class="status status--${r.champion ? "gold" : "active"}">${r.points} pt${r.points === 1 ? "" : "s"}</span>`
        : wOut
          ? `<span class="status status--out">Playing for 2nd</span>`
          : `<span class="status status--active">Winner pick alive</span>`;
      return `
        <tr>
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
      return `
        <article class="card player-card">
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
                  ${statusOf(w).spoken ? `<div class="castaway__spoken">The tribe has spoken.</div>` : ""}
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
        <article class="card tribe${colorClass}" style="${tribe.color ? "" : tribeStyle(tribeId)}">
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
          <li class="card boot">
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
      return `<div class="card cast-card">${castawayBlock(c, {
        showTribe: true,
        meta: `${c.age} · ${esc(c.occupation)}<br>${esc(c.hometown)}<br><em>${draftLine}</em>`,
      })}</div>`;
    }).join("");
  }

  function renderAll() {
    const rows = computeStandings();
    renderHero();
    renderStandings(rows);
    renderDraft(rows);
    renderTribes();
    renderBootOrder();
    renderCastFilters();
    renderCast();
  }

  // ---------- data loading ----------
  async function fetchJson(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  async function load() {
    try {
      const [cast, draft] = await Promise.all([fetchJson("data/castaways.json"), fetchJson("data/draft.json")]);
      const changed = cast.lastUpdated !== state.lastUpdated || !state.draft;
      state.cast = cast;
      state.draft = draft;
      state.lastUpdated = cast.lastUpdated;
      $("error").innerHTML = "";
      if (changed) renderAll();
    } catch (err) {
      console.error(err);
      if (!state.cast) {
        $("error").innerHTML = `<div class="notice">Couldn't load the season data. Try refreshing the page.</div>`;
      }
    }
  }

  // ---------- interactions ----------
  $("cast-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    state.castFilter = btn.dataset.filter;
    renderCastFilters();
    renderCast();
  });

  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }

  try { applyTheme(localStorage.getItem("theme")); } catch (e) { /* storage unavailable */ }

  $("theme-toggle").addEventListener("click", () => {
    const current = document.documentElement.dataset.theme
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem("theme", next); } catch (e) { /* storage unavailable */ }
  });

  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") load();
  });
})();
