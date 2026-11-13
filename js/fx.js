/* Probst's Posse — motion layer.
   Optional polish on top of app.js: the page works without this file, and
   nothing here moves when the visitor has asked for reduced motion. */

(function () {
  "use strict";

  const root = document.documentElement;
  const reduced = root.classList.contains("still") || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FX = { reduced };
  window.PosseFX = FX;

  // ---------- scroll reveals ----------
  let revealer = null;
  if (root.classList.contains("fx") && "IntersectionObserver" in window) {
    revealer = new IntersectionObserver((entries) => {
      let batch = 0;
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        // Stagger whatever arrives together, such as a row of cards
        entry.target.style.setProperty("--d", `${Math.min(batch++, 8) * 70}ms`);
        entry.target.classList.add("is-in");
        revealer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });
  } else {
    root.classList.remove("fx");
  }

  /** Start watching any new .reveal elements. app.js calls this after it renders. */
  FX.scan = function () {
    if (!revealer) return;
    document.querySelectorAll(".reveal:not(.is-in)").forEach((el) => revealer.observe(el));
  };

  // ---------- hero embers ----------
  function startEmbers(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // One pre-rendered glow, stamped once per ember per frame
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 64;
    const sctx = sprite.getContext("2d");
    const glow = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, "rgba(255, 244, 214, 1)");
    glow.addColorStop(0.18, "rgba(242, 198, 109, 0.95)");
    glow.addColorStop(0.45, "rgba(232, 139, 53, 0.45)");
    glow.addColorStop(1, "rgba(232, 139, 53, 0)");
    sctx.fillStyle = glow;
    sctx.fillRect(0, 0, 64, 64);

    let width = 0, height = 0, embers = [], frame = 0, last = 0, onScreen = true;

    function spawn(anywhere) {
      return {
        x: Math.random() * width,
        y: anywhere ? Math.random() * height : height + 12,
        size: 5 + Math.random() * 13,
        rise: 16 + Math.random() * 38,      // px per second
        sway: 6 + Math.random() * 22,
        speed: 0.5 + Math.random() * 1.1,
        phase: Math.random() * 6.283,
        age: anywhere ? Math.random() * 4 : 0,
        life: 4 + Math.random() * 6,        // seconds
      };
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.round(Math.min(80, Math.max(22, width / 18)));
      while (embers.length < count) embers.push(spawn(true));
      embers.length = count;
    }

    function tick(now) {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < embers.length; i++) {
        const e = embers[i];
        e.age += dt;
        e.y -= e.rise * dt;
        if (e.age >= e.life || e.y < -20) {
          embers[i] = spawn(false);
          continue;
        }
        const fade = Math.sin((Math.PI * e.age) / e.life);
        const flicker = 0.7 + 0.3 * Math.sin(e.phase + e.age * 7);
        const x = e.x + Math.sin(e.phase + e.age * e.speed) * e.sway;
        ctx.globalAlpha = fade * flicker * 0.85;
        ctx.drawImage(sprite, x - e.size / 2, e.y - e.size / 2, e.size, e.size);
      }
      ctx.globalAlpha = 1;
    }

    // Only burn CPU while the hero is actually on screen in a visible tab
    function update() {
      const run = onScreen && document.visibilityState === "visible";
      if (run && !frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      } else if (!run && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }

    resize();
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener("resize", resize);
    new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      update();
    }).observe(canvas);
    document.addEventListener("visibilitychange", update);
    update();
  }

  // ---------- nav: reading progress, current section, mobile menu ----------
  function startNav() {
    const nav = document.querySelector(".nav");
    const bar = document.getElementById("nav-progress");
    const strip = document.getElementById("nav-links");
    const button = document.getElementById("nav-menu-btn");
    const links = Array.from(document.querySelectorAll(".nav__link"));
    const sections = Array.from(document.querySelectorAll("main .section[id]"));
    let queued = false, currentId = null;

    function setCurrent(id) {
      if (id === currentId) return;
      currentId = id;
      links.forEach((link) => {
        if (link.getAttribute("href") !== `#${id}`) {
          link.removeAttribute("aria-current");
          return;
        }
        link.setAttribute("aria-current", "location");
        // When the links scroll sideways, keep the current one in view
        if (strip && strip.scrollWidth > strip.clientWidth) {
          const l = link.getBoundingClientRect(), s = strip.getBoundingClientRect();
          strip.scrollTo({
            left: strip.scrollLeft + (l.left - s.left) - (s.width - l.width) / 2,
            behavior: reduced ? "auto" : "smooth",
          });
        }
      });
    }

    function measure() {
      queued = false;
      const max = root.scrollHeight - window.innerHeight;
      if (bar) bar.style.setProperty("--progress", max > 0 ? Math.min(1, window.scrollY / max).toFixed(4) : "0");
      // Current = the last section whose top has passed a line 38% down the screen.
      // Above the first section it is "top" (Home); at the very bottom it is the last
      // section, even when that one is too short to ever reach the line
      const line = window.innerHeight * 0.38;
      let id = "top";
      for (const section of sections) {
        if (section.getBoundingClientRect().top > line) break;
        id = section.id;
      }
      if (sections.length && window.scrollY > 0 && window.scrollY >= max - 2) {
        id = sections[sections.length - 1].id;
      }
      setCurrent(id);
    }

    function onScroll() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // The page grows when app.js renders, which moves every section
    if ("ResizeObserver" in window) new ResizeObserver(onScroll).observe(document.body);
    measure();

    if (!nav || !button || !strip) return;
    root.classList.add("nav-js");
    const setOpen = (open) => {
      nav.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", String(open));
    };
    button.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
    strip.addEventListener("click", (e) => {
      if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("click", (e) => {
      if (!nav.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !nav.classList.contains("is-open")) return;
      setOpen(false);
      button.focus();
    });
    // Back on a wide screen: make sure the drop-down is not left open
    const wide = matchMedia("(min-width: 901px)");
    if (wide.addEventListener) wide.addEventListener("change", () => setOpen(false));
  }

  // ---------- cards: glow follows the cursor ----------
  function startGlow() {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let card = null, x = 0, y = 0, queued = false;
    document.addEventListener("pointermove", (e) => {
      card = e.target instanceof Element ? e.target.closest(".card") : null;
      x = e.clientX;
      y = e.clientY;
      if (!card || queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (!card) return;
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${x - rect.left}px`);
        card.style.setProperty("--my", `${y - rect.top}px`);
      });
    }, { passive: true });
  }

  // ---------- numbers that count up ----------
  /** Counts an element's text up to its data-count value. */
  FX.countUp = function (el, delay) {
    const target = Number(el.dataset.count);
    if (reduced || !Number.isFinite(target) || target <= 0) return;
    const duration = 900 + Math.min(600, target * 30);
    el.textContent = "0";
    setTimeout(() => {
      const start = performance.now();
      (function step(now) {
        const t = Math.min(1, Math.max(0, (now - start) / duration));
        el.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
        if (t < 1) requestAnimationFrame(step);
      })(start);
    }, delay || 0);
  };

  // ---------- confetti in buff colours, for the champion ----------
  FX.confetti = function () {
    if (reduced) return;
    const canvas = document.createElement("canvas");
    canvas.className = "confetti";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.scale(ratio, ratio);

    const colors = ["#f6c623", "#8fd6e8", "#5a2a82", "#b5d334", "#e5325f", "#1d5fc2", "#E88B35", "#F2C66D"];
    const pieces = [];
    for (let i = 0; i < 180; i++) {
      // Two cannons, one in each bottom corner, firing up and inward
      const fromLeft = i % 2 === 0;
      const angle = (fromLeft ? -Math.PI / 3 : (-2 * Math.PI) / 3) + (Math.random() - 0.5) * 0.9;
      const speed = (0.55 + Math.random() * 0.75) * Math.max(700, h * 1.25);
      pieces.push({
        x: fromLeft ? -10 : w + 10,
        y: h * 0.8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 7,
        h: 9 + Math.random() * 9,
        spin: Math.random() * 6.283,
        vspin: (Math.random() - 0.5) * 14,
        color: colors[i % colors.length],
        delay: Math.random() * 0.5,
      });
    }

    const LIFE = 7;
    let last = performance.now(), elapsed = 0;
    (function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      pieces.forEach((p) => {
        if (elapsed < p.delay) {
          alive++;
          return;
        }
        p.vy += 1100 * dt;
        p.vx *= 1 - 0.9 * dt;
        p.vy *= 1 - 0.5 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.spin += p.vspin * dt;
        if (p.y > h + 30) return;
        alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.scale(1, Math.cos(p.spin * 1.7));
        ctx.globalAlpha = Math.max(0, Math.min(1, (LIFE - elapsed) / 1.5));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (alive && elapsed < LIFE) requestAnimationFrame(tick);
      else canvas.remove();
    })(last);
  };

  // ---------- view transitions ----------
  /** Runs a DOM update as a view transition where supported. `flag` is a class
      put on <html> for the duration so CSS can tailor the transition. */
  const flagged = {};
  FX.transition = function (update, flag) {
    if (reduced || !document.startViewTransition) {
      update();
      return null;
    }
    if (flag) {
      root.classList.add(flag);
      flagged[flag] = (flagged[flag] || 0) + 1;
    }
    const transition = document.startViewTransition(update);
    transition.finished.catch(() => {}).then(() => {
      // A quick second click starts a new transition before this one is over:
      // the flag stays until the last of them has finished
      if (flag && --flagged[flag] === 0) root.classList.remove(flag);
    });
    return transition;
  };

  // ---------- start ----------
  const embers = document.getElementById("embers");
  if (embers && !reduced && "IntersectionObserver" in window) startEmbers(embers);
  startNav();
  if (!reduced) startGlow();
  FX.scan();
})();
