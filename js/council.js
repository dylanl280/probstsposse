/* Probst's Posse — Tribal Council.
   The torch-snuffing ceremony for an eliminated castaway, and its optional sound.
   Optional, like fx.js: without this file the Boot Order is a plain list. */

(function () {
  "use strict";

  const root = document.documentElement;
  const still = () => root.classList.contains("still");
  const supported = typeof HTMLDialogElement === "function"
    && typeof HTMLDialogElement.prototype.showModal === "function";

  // ---------- sound: synthesized, and silent until the visitor turns it on ----------
  const SOUND_KEY = "posse:sound";
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let soundOn = false, audio = null;
  try { soundOn = localStorage.getItem(SOUND_KEY) === "on"; } catch (e) { /* storage unavailable */ }

  /** Browsers only allow audio after a click or key press, so this runs from one. */
  function wake() {
    if (!AudioCtx) return null;
    if (!audio) audio = new AudioCtx();
    if (audio.state === "suspended") audio.resume();
    return audio;
  }

  /** A torch being snuffed: a hiss that darkens and dies away, over a soft thump. */
  function snuffSound() {
    if (!soundOn || !audio || audio.state !== "running") return;
    const t = audio.currentTime, len = 1.1;
    const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * len), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = audio.createBufferSource();
    noise.buffer = buffer;
    const low = audio.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.setValueAtTime(5200, t);
    low.frequency.exponentialRampToValueAtTime(260, t + len);
    const high = audio.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 180;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.03);   // quiet on purpose
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
    // One connection per line: older Safari's connect() returns nothing to chain on
    noise.connect(low);
    low.connect(high);
    high.connect(gain);
    gain.connect(audio.destination);
    noise.start(t);
    noise.stop(t + len);

    const thump = audio.createOscillator();
    thump.frequency.setValueAtTime(110, t);
    thump.frequency.exponentialRampToValueAtTime(42, t + 0.25);
    const thumpGain = audio.createGain();
    thumpGain.gain.setValueAtTime(0.0001, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    thump.connect(thumpGain);
    thumpGain.connect(audio.destination);
    thump.start(t);
    thump.stop(t + 0.4);
  }

  const toggle = document.getElementById("sound-toggle");
  if (toggle && supported && AudioCtx) {
    toggle.hidden = false;
    toggle.setAttribute("aria-pressed", String(soundOn));
    toggle.addEventListener("click", () => {
      soundOn = !soundOn;
      try { localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off"); } catch (e) { /* storage unavailable */ }
      toggle.setAttribute("aria-pressed", String(soundOn));
      // Let them hear what they just turned on
      if (soundOn && wake()) setTimeout(snuffSound, 80);
    });
    // A saved "on" still needs one click or key press before the browser allows audio
    if (soundOn) ["pointerdown", "keydown"].forEach((type) => document.addEventListener(type, wake, { once: true }));
  }

  // ---------- the ceremony ----------
  const COUNCIL_TEMPLATE = `
<div class="council__embers" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
<div class="council__stage">
  <p class="council__eyebrow" data-part="eyebrow"></p>
  <div class="council__scene">
    <img class="council__photo" data-part="photo" alt="" width="220" height="220">
    <svg class="council__torch" viewBox="0 0 120 320" aria-hidden="true" focusable="false">
      <g class="council__fire">
        <path class="council__flame council__flame--outer" d="M60 8 C78 40 98 62 96 92 C94 116 80 132 60 132 C40 132 26 116 24 92 C22 72 36 60 42 40 C46 52 52 58 56 60 C60 44 62 26 60 8 Z"/>
        <path class="council__flame council__flame--mid" d="M60 44 C72 64 84 78 82 98 C80 116 72 126 60 126 C48 126 40 116 38 98 C37 84 46 76 50 64 C53 72 56 75 58 76 C60 66 61 54 60 44 Z"/>
        <path class="council__flame council__flame--inner" d="M60 76 C68 88 73 96 72 107 C71 117 66 122 60 122 C54 122 49 117 48 107 C47 97 53 88 60 76 Z"/>
      </g>
      <g class="council__smoke">
        <path d="M60 120C48 100 72 84 60 62C50 44 68 30 62 10"/>
        <path d="M52 118C44 102 58 92 50 74C44 60 54 50 50 36"/>
        <path d="M68 118C76 104 62 92 70 76C76 64 66 52 70 40"/>
      </g>
      <path class="council__pole" d="M53 178H67L65 320H55Z"/>
      <path class="council__head" d="M30 128H90L80 172H40Z"/>
      <path class="council__wrap" d="M33 140H87M36.5 155H83.5M46 129L52 171M74 129L68 171M60 129V171"/>
      <path class="council__band" d="M38 170H82V178H38Z"/>
    </svg>
  </div>
  <div class="council__vote" aria-hidden="true"><span data-part="vote"></span></div>
  <h2 class="council__name" id="council-name" data-part="name"></h2>
  <p class="council__finish" data-part="finish"></p>
  <p class="council__line" data-part="line"></p>
  <div class="council__actions">
    <span class="council__count" data-part="count"></span>
    <button class="council__close" type="button" data-part="close">Skip</button>
  </div>
</div>`;

  let dialog = null, parts = null, timers = [];
  const queue = [];   // jobs: { list, index, manual, opener, resolve }

  function build() {
    dialog = document.createElement("dialog");
    dialog.setAttribute("aria-labelledby", "council-name");
    // A fixed template: castaway data is filled in with textContent below, never as HTML
    dialog.innerHTML = COUNCIL_TEMPLATE;
    document.body.appendChild(dialog);
    parts = {};
    dialog.querySelectorAll("[data-part]").forEach((el) => { parts[el.dataset.part] = el; });
    parts.close.addEventListener("click", next);
    // A click outside the stage lands on the dialog itself: close
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener("close", onClose);   // also fires for Esc
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function at(ms, fn) {
    timers.push(setTimeout(fn, ms));
  }

  function show(job) {
    const item = job.list[job.index];
    const more = job.index + 1 < job.list.length;
    clearTimers();
    dialog.className = "council night";              // resets the timeline
    dialog.style.cssText = item.style || "";         // --tribe-color for the portrait ring
    parts.eyebrow.textContent = ["Tribal Council", item.detail].filter(Boolean).join(" · ");
    parts.photo.src = item.photo;
    parts.vote.textContent = item.shortName;
    parts.name.textContent = item.name;
    parts.finish.textContent = item.finish;
    parts.line.textContent = item.line;
    parts.count.textContent = job.list.length > 1 ? `${job.index + 1} of ${job.list.length}` : "";
    parts.close.textContent = "Skip";
    if (!dialog.open) dialog.showModal();
    const done = () => {
      dialog.classList.add("is-done");
      parts.close.textContent = more ? "Next" : "Close";
    };
    if (still()) {
      // No motion: straight to the final frame, which stays until it is closed
      dialog.classList.add("is-vote", "is-snuff", "is-out");
      done();
      return;
    }
    at(900, () => dialog.classList.add("is-vote"));
    at(2300, () => { dialog.classList.add("is-snuff"); snuffSound(); });
    at(3000, () => dialog.classList.add("is-out"));
    at(5200, done);
    if (job.manual) return;   // a replay they asked for waits for them
    at(5900, () => dialog.classList.add("is-leaving"));
    at(6400, next);
  }

  /** The next castaway in the current job, or close when there are none left. */
  function next() {
    const job = queue[0];
    if (!job) return;
    job.index++;
    if (job.index < job.list.length) show(job);
    else dialog.close();
  }

  function onClose() {
    clearTimers();
    const job = queue.shift();
    if (job) {
      if (job.opener && job.opener.isConnected) job.opener.focus();
      job.resolve();
    }
    start();
  }

  function start() {
    const job = queue[0];
    if (!job) return;
    // Wait until someone is actually looking at the tab
    if (document.visibilityState !== "visible") {
      document.addEventListener("visibilitychange", start, { once: true });
      return;
    }
    show(job);
  }

  /** Plays the ceremony for each castaway in `list` and resolves when it is over.
      options.manual: the visitor asked for it. options.opener: gets focus back. */
  function play(list, options) {
    const manual = Boolean(options && options.manual);
    if (!supported || !list || !list.length || (still() && !manual)) return Promise.resolve();
    if (manual) wake();
    if (!dialog) build();
    return new Promise((resolve) => {
      queue.push({ list, index: 0, manual, opener: options && options.opener, resolve });
      if (queue.length === 1) start();
    });
  }

  window.PosseCouncil = { supported, play };
})();
