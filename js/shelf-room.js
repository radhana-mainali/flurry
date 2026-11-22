// The cosy room behind My Shelf (images/background.png):
// - snow falling past the window (the window glass in the drawing is
//   see-through, so the snow canvas sits behind it and the frame covers it)
// - a soft fire crackle, made right here in the browser (no audio file).
//   It follows the music button in the corner: on when the music is on,
//   off when it's paused, and quiet while a globe replays a video.

(() => {
  // ---------- snow outside the window ----------

  const canvas = document.querySelector(".room-snow");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (canvas) {
    const ctx = canvas.getContext("2d");
    let W = 0;
    let H = 0;
    let dpr = 1;
    let flakes = [];
    let last = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      if (!flakes.length) {
        flakes = Array.from({ length: 90 }, () => ({
          x: Math.random(),
          y: Math.random(),
          r: 0.5 + Math.random() * 1.3,       // size, in "window pixels"
          speed: 0.06 + Math.random() * 0.1,  // window heights per second
          sway: Math.random() * Math.PI * 2,
          drift: 0.004 + Math.random() * 0.008
        }));
      }
      draw(0);
    };

    function draw(dt) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
      const scale = W / 300;  // flakes grow with the window
      flakes.forEach(f => {
        f.y += f.speed * dt;
        f.sway += dt * 1.3;
        f.x += Math.sin(f.sway) * f.drift * dt;
        if (f.y > 1.02) {
          f.y = -0.02;
          f.x = Math.random();
        }
        ctx.beginPath();
        ctx.arc(f.x * W, f.y * H, f.r * scale, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    function frame(now) {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      draw(dt);
      requestAnimationFrame(frame);
    }

    window.addEventListener("resize", resize);
    resize();
    if (!still) requestAnimationFrame(frame);
  }

  // ---------- fire crackle ----------

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx || !Flurry.music || !Flurry.music.onChange) return;

  const VOLUME = 0.5;
  let audio = null;
  let master = null;
  let noise = null;
  let timer = null;
  let on = false;

  // one second of white noise to cut crackles from
  function makeNoise(ac) {
    const buffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function setup() {
    audio = new AudioCtx();
    noise = makeNoise(audio);
    master = audio.createGain();
    master.gain.value = 0;
    master.connect(audio.destination);

    // the low, soft roar of the fire underneath
    const bed = audio.createBufferSource();
    bed.buffer = noise;
    bed.loop = true;
    const low = audio.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 380;
    const bedGain = audio.createGain();
    bedGain.gain.value = 0.16;
    bed.connect(low).connect(bedGain).connect(master);
    bed.start();
  }

  // one little snap of wood
  function crackle(at) {
    const pop = Math.random() < 0.12;   // now and then a bigger pop
    const src = audio.createBufferSource();
    src.buffer = noise;
    const band = audio.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = pop ? 500 + Math.random() * 900 : 1800 + Math.random() * 4200;
    band.Q.value = pop ? 1.2 : 0.8 + Math.random() * 2;
    const gain = audio.createGain();
    const length = pop ? 0.03 + Math.random() * 0.05 : 0.004 + Math.random() * 0.02;
    const peak = pop ? 0.5 + Math.random() * 0.4 : 0.08 + Math.random() * 0.3;
    gain.gain.setValueAtTime(peak, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + length);
    src.connect(band).connect(gain).connect(master);
    src.start(at, Math.random() * 0.9, length + 0.02);
  }

  // Plan crackles a little ahead, in uneven bursts like a real fire
  let next = 0;
  function schedule() {
    const until = audio.currentTime + 0.25;
    if (next < audio.currentTime) next = audio.currentTime + 0.05;
    while (next < until) {
      crackle(next);
      const burst = Math.random() < 0.35;
      next += burst ? 0.02 + Math.random() * 0.07 : 0.12 + Math.random() * 0.55;
    }
  }

  function fade(target, seconds) {
    const t = audio.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(target, t + seconds);
  }

  function start() {
    if (!audio) setup();
    if (audio.state === "suspended") audio.resume().catch(() => {});
    if (!timer) timer = setInterval(schedule, 100);
    fade(VOLUME, 1.5);
  }

  function stop() {
    if (!audio) return;
    fade(0, 0.5);
    clearInterval(timer);
    timer = null;
  }

  // Browsers only allow sound after you interact with the page
  let unlocked = false;
  const unlock = () => {
    unlocked = true;
    ["pointerdown", "keydown", "touchend"].forEach(type =>
      document.removeEventListener(type, unlock, true));
    if (on) start();
  };
  ["pointerdown", "keydown", "touchend"].forEach(type =>
    document.addEventListener(type, unlock, true));

  Flurry.fire = {
    get playing() { return !!timer && !!audio && audio.state === "running"; }
  };

  Flurry.music.onChange(audible => {
    on = audible;
    if (on && (unlocked || navigator.userActivation?.hasBeenActive)) start();
    else if (!on) stop();
  });
})();
