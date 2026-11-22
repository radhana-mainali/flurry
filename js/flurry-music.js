// Background music for Flurry (homepage + My Shelf).
//
// - Music is on by default. Browsers don't allow sound before you
//   interact with a page, so if autoplay is blocked it starts on your
//   first click, tap or key press.
// - The little snowflake in the corner pauses / plays it. The choice is
//   remembered in this browser.
// - While a snow globe replays a video with sound, the music fades out,
//   and fades back in afterwards (only if it was on).
// - It carries on from the same spot when you move between pages.
//
// The track is audio/flurry-lofi.m4a, an original loop made for Flurry.
// To use a different song, replace that file (or change MUSIC_SRC) with
// music you made or have permission to use.

window.Flurry = window.Flurry || {};

Flurry.music = (() => {
  const MUSIC_SRC = "./audio/flurry-lofi.m4a";
  const VOLUME = 0.22;          // gentle, under everything else
  const PREF_KEY = "flurryMusic";
  const TIME_KEY = "flurryMusicTime";

  const audio = new Audio(MUSIC_SRC);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0;

  let wanted = readPref() !== "off";
  let ducked = false;
  let fadeTimer = null;
  let button = null;
  let label = null;

  function readPref() {
    try { return localStorage.getItem(PREF_KEY); } catch (e) { return null; }
  }

  function savePref() {
    try { localStorage.setItem(PREF_KEY, wanted ? "on" : "off"); } catch (e) {}
  }

  // Pick up where the last page left off
  try {
    const saved = parseFloat(sessionStorage.getItem(TIME_KEY));
    if (saved > 0) {
      audio.addEventListener("loadedmetadata", () => {
        if (saved < audio.duration) audio.currentTime = saved;
      }, { once: true });
    }
  } catch (e) {}

  window.addEventListener("pagehide", () => {
    try { sessionStorage.setItem(TIME_KEY, String(audio.currentTime)); } catch (e) {}
  });

  // Smooth volume changes (some phones ignore volume; pausing still works)
  function fadeTo(target, ms, then) {
    clearInterval(fadeTimer);
    const start = audio.volume;
    const t0 = performance.now();
    fadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      audio.volume = Math.max(0, Math.min(1, start + (target - start) * k));
      if (k >= 1) {
        clearInterval(fadeTimer);
        if (then) then();
      }
    }, 30);
  }

  function shouldPlay() {
    return wanted && !ducked;
  }

  function play() {
    if (!shouldPlay()) return;
    const p = audio.play();
    if (p && p.then) {
      p.then(() => fadeTo(VOLUME, 1200)).catch(waitForGesture);
    } else {
      fadeTo(VOLUME, 1200);
    }
  }

  function stop(ms = 600) {
    fadeTo(0, ms, () => audio.pause());
  }

  // Autoplay was blocked: start on the first interaction instead
  let waiting = false;
  function waitForGesture() {
    if (waiting) return;
    waiting = true;
    const go = event => {
      // the music button handles its own click
      if (button && button.contains(event.target)) return;
      waiting = false;
      ["pointerdown", "keydown", "touchend"].forEach(type =>
        document.removeEventListener(type, go, true));
      play();
    };
    ["pointerdown", "keydown", "touchend"].forEach(type =>
      document.addEventListener(type, go, true));
  }

  function render() {
    if (!button) return;
    const on = wanted;
    button.classList.toggle("is-playing", on);
    button.setAttribute("aria-pressed", String(on));
    // Say what clicking will do
    label.textContent = on ? "pause music" : "play music";
    button.title = on ? "Pause the background music" : "Play the background music";
  }

  function toggle() {
    wanted = !wanted;
    savePref();
    render();
    if (wanted) play();
    else stop(400);
  }

  // Called by the snow globe: quiet the music while a clip plays with sound
  function duck(on) {
    if (on === ducked) return;
    ducked = on;
    if (ducked) {
      if (!audio.paused) stop(450);
    } else if (wanted) {
      play();
    }
  }

  function mount() {
    button = document.createElement("button");
    button.className = "music-toggle";
    button.type = "button";

    // The team's hand-drawn snowflake sticker, spinning slowly while music plays
    const img = document.createElement("img");
    img.src = "./images/stickers/snowflake.png";
    img.alt = "";
    img.className = "music-flake";

    const note = document.createElement("span");
    note.className = "music-note";
    note.setAttribute("aria-hidden", "true");
    note.textContent = "♪";

    label = document.createElement("span");
    label.className = "music-label";

    button.append(img, note, label);
    button.addEventListener("click", toggle);
    document.body.appendChild(button);
    render();
    play();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  return { toggle, duck, get playing() { return !audio.paused; }, audio };
})();
