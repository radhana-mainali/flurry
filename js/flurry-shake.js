// Shake the snow globe!
//
// - Drag the globe left and right (mouse or touch), or call shake()
// - The globe tilts and wobbles; the snow resting on the mound is thrown
//   up, swirls with the water the way you shook it, and drifts back down
// - If the memory has its video, each photo turns into a short clip of
//   that moment (with sound), one at a time, then fades back to the photo
//
// Usage:
//   const fx = new Flurry.ShakeGlobe(globeElement, { onStateChange });
//   fx.setMemory({ videoUrl, times, duration, rotation });  // optional
//   fx.enabled = true;

window.Flurry = window.Flurry || {};

Flurry.ShakeGlobe = class {
  constructor(el, { onStateChange = () => {} } = {}) {
    this.el = el;
    this.onStateChange = onStateChange;
    this.enabled = false;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.memory = null;
    this.playing = false;
    this.runId = 0;
    this.muted = false;

    this.buildLayers();
    this.setupSnow();
    this.setupDrag();
  }

  // ---------- layers ----------

  buildLayers() {
    this.frame = this.el.querySelector(".globe-video");
    if (!this.frame) {
      this.frame = document.createElement("div");
      this.frame.className = "globe-video";
      this.frame.innerHTML = '<video playsinline preload="auto"></video>';
      this.el.appendChild(this.frame);
    }
    this.video = this.frame.querySelector("video");
    this.video.playsInline = true;
    this.video.setAttribute("playsinline", "");

    this.canvas = this.el.querySelector(".globe-snow");
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.className = "globe-snow";
      this.el.appendChild(this.canvas);
    }
    this.ctx = this.canvas.getContext("2d");
  }

  // ---------- memory / video ----------

  setMemory(memory) {
    this.stop();
    this.memory = memory;
    this.primed = false;
    if (memory && memory.videoUrl) {
      this.video.src = memory.videoUrl;
      this.video.load();
    } else {
      this.video.removeAttribute("src");
      this.video.load();
    }
    this.emit();
  }

  get canReplay() {
    return !!(this.memory && this.memory.videoUrl && this.memory.times && this.memory.times.length);
  }

  setMuted(muted) {
    this.muted = muted;
    this.video.muted = muted;
    this.emit();
  }

  // One click always flips what you actually hear (even if the browser
  // had muted a clip on its own)
  toggleMuted() {
    this.setMuted(!(this.muted || this.video.muted));
  }

  emit() {
    this.onStateChange({
      playing: this.playing,
      canReplay: this.canReplay,
      muted: this.muted || this.video.muted
    });
  }

  // Browsers only allow sound after a tap/click. Calling play() during
  // the pointerdown / click itself "unlocks" this video element so the
  // clips started a moment later can have audio (needed for Safari).
  prime() {
    if (this.primed || !this.canReplay || this.playing) return;
    this.primed = true;
    const v = this.video;
    v.muted = this.muted;
    const p = v.play();
    if (p) {
      p.then(() => { if (!this.playing) v.pause(); })
        .catch(() => { this.primed = false; });
    }
  }

  // ---------- shaking ----------

  shake(strength = 1, direction = 0) {
    if (!this.enabled) return;
    this.stir(strength, direction);

    if (!this.reducedMotion && !this.dragging) {
      this.el.classList.remove("is-wobbling");
      void this.el.offsetWidth; // restart the animation
      this.el.classList.add("is-wobbling");
    }

    if (this.canReplay && !this.playing) {
      this.replay();
    }
  }

  setupDrag() {
    let startX = 0;
    let lastX = 0;
    let segment = 0;
    let dir = 0;
    let reversals = 0;
    let travel = 0;
    let fired = false;

    this.el.addEventListener("animationend", () => {
      this.el.classList.remove("is-wobbling");
    });

    this.el.addEventListener("pointerdown", event => {
      if (!this.enabled || event.button !== 0) return;
      this.prime();
      this.dragging = true;
      this.moved = false;
      startX = lastX = event.clientX;
      segment = dir = reversals = travel = 0;
      fired = false;
      try { this.el.setPointerCapture(event.pointerId); } catch (e) {}
    });

    this.el.addEventListener("pointermove", event => {
      if (!this.dragging) return;
      const dx = event.clientX - lastX;
      lastX = event.clientX;
      travel += Math.abs(dx);
      if (travel > 6) this.moved = true;

      const d = Math.sign(dx);
      if (d && d !== dir) {
        if (Math.abs(segment) > 14) reversals++;
        dir = d;
        segment = 0;
      }
      segment += dx;

      // Tilt with the drag
      if (!this.reducedMotion) {
        const tilt = Math.max(-12, Math.min(12, (event.clientX - startX) * 0.12));
        this.el.style.transition = "transform 0.08s linear";
        this.el.style.transform = `rotate(${tilt}deg)`;
      }

      // Keep stirring the snow while shaking
      if (this.active || fired) this.stir(Math.min(Math.abs(dx) / 25, 0.6), d);

      if (!fired && (reversals >= 2 || travel > 220)) {
        fired = true;
        this.shake(1, d);
      }
    });

    const end = () => {
      if (!this.dragging) return;
      this.dragging = false;
      // Spring back upright with a little overshoot
      this.el.style.transition = "transform 0.6s cubic-bezier(0.3, 1.8, 0.5, 1)";
      this.el.style.transform = "";
      setTimeout(() => { this.el.style.transition = ""; }, 650);
    };
    this.el.addEventListener("pointerup", end);
    this.el.addEventListener("pointercancel", end);

    // A shake shouldn't also count as a click (e.g. open the file picker)
    this.el.addEventListener("click", event => {
      if (this.moved) {
        event.stopPropagation();
        event.preventDefault();
        this.moved = false;
      }
    }, true);
  }

  // ---------- snow inside the dome ----------
  //
  // The snow lives in "water": each flake follows the water's flow and
  // sinks slowly through it. At rest the flakes lie on the drawn snow
  // mound. A shake throws them up from the bottom and sets the water
  // sloshing and swirling in the direction you shook; then it calms
  // down and the flakes drift back down and settle again.
  //
  // Positions and speeds are in units of the globe's width, so the
  // snow keeps its place when the globe changes size.

  setupSnow() {
    this.flakes = [];
    this.active = false;
    this.water = { swirl: 0, slosh: 0, stir: 0, t: 0 };
    this.W = 1;
    this.H = 1;

    const resize = () => {
      // Hidden globes (like the shelf viewer before it opens) have no size
      // yet: wait until they're shown, or the snow lands in the wrong place
      if (!this.el.clientWidth || !this.el.clientHeight) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.W = this.el.clientWidth;
      this.H = this.el.clientHeight;
      this.canvas.width = Math.round(this.W * dpr);
      this.canvas.height = Math.round(this.H * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!this.flakes.length) this.makeFlakes();
      // keep resting snow on the mound when the globe changes shape
      this.flakes.forEach(f => { if (f.settled) this.restOnMound(f, false); });
      if (!this.active) this.draw();
    };
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(this.el);
    this.canvas.classList.add("is-on");
  }

  makeFlakes() {
    for (let i = 0; i < 170; i++) {
      const f = {
        x: 0, y: 0, vx: 0, vy: 0,
        r: 0.0032 + Math.random() * 0.0042,      // radius
        sink: 0.055 + Math.random() * 0.06,      // how fast it sinks
        phase: Math.random() * Math.PI * 2,
        nest: 0.004 - Math.random() * 0.012,     // how deep it sits in the snow
        settled: true
      };
      this.restOnMound(f, true);
      this.flakes.push(f);
    }
  }

  // The glass, in width units
  dome() {
    const d = Flurry.GLOBE.dome;
    const k = this.H / this.W;
    return { cx: d.cx, cy: d.cy * k, r: d.r * 0.94 };
  }

  // Top of the drawn snow mound at x (it slopes up to the right)
  moundY(x) {
    const pts = Flurry.GLOBE.mound;
    let y = pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      if (x <= x1) {
        const t = Math.max(0, Math.min(1, (x - x0) / (x1 - x0)));
        y = y0 + (y1 - y0) * t;
        break;
      }
      y = y1;
    }
    return y * this.H / this.W;
  }

  // Where the mound meets the glass
  moundSpan() {
    const pts = Flurry.GLOBE.mound;
    return [pts[0][0] + 0.01, pts[pts.length - 1][0] - 0.01];
  }

  restOnMound(f, anywhere) {
    if (anywhere) {
      const [a, b] = this.moundSpan();
      f.x = a + Math.random() * (b - a);
    }
    // nestle into the top of the snow, a little bit of it showing
    f.y = this.moundY(f.x) + f.nest;
    f.vx = f.vy = 0;
    f.settled = true;
  }

  // Shake the water. strength ~0..1.4, direction -1 (left) / 1 (right)
  stir(strength, direction) {
    const calm = this.reducedMotion ? 0.25 : 1;
    const s = strength * calm;
    const w = this.water;
    const dir = direction || (Math.random() < 0.5 ? -1 : 1);

    w.swirl = Math.max(-1.6, Math.min(1.6, w.swirl + dir * s * 0.9));
    w.slosh = Math.max(-1.2, Math.min(1.2, w.slosh + dir * s * 0.7));
    w.stir = Math.min(1.5, w.stir + s);

    for (const f of this.flakes) {
      if (f.settled) {
        // Strong shakes lift almost everything, little wiggles lift some
        if (Math.random() > Math.min(1, s * 1.15)) continue;
        f.settled = false;
        f.vy = -(0.9 + Math.random() * 1.4) * s;
        f.vx = ((Math.random() - 0.5) * 0.7 + dir * 0.45) * s;
      } else {
        f.vx += ((Math.random() - 0.5) * 0.35 + dir * 0.3) * s;
        f.vy += (Math.random() - 0.65) * 0.4 * s;
      }
    }

    if (!this.active) {
      this.active = true;
      this.last = performance.now();
      requestAnimationFrame(t => this.tick(t));
    }
  }

  // How the water is moving at (x, y)
  flow(x, y, cx, cy, r) {
    const w = this.water;
    const dx = x - cx;
    const dy = y - cy;
    // swirl: the water turns round the middle like a whirlpool
    const spin = w.swirl * 1.1;
    let ux = -dy * spin;
    let uy = dx * spin;
    // slosh: side to side, rolling up the walls
    ux += w.slosh * 0.32;
    uy += -w.slosh * 0.32 * (dx / r) * 0.6;
    // eddies: little random curls so the snow tumbles
    const e = w.stir * 0.11;
    const t = w.t;
    ux += e * Math.sin(y * 21 + t * 1.7) + e * 0.6 * Math.sin(y * 9 - t * 1.1 + 2);
    uy += e * Math.cos(x * 19 - t * 1.4) + e * 0.6 * Math.cos(x * 7 + t * 0.9 + 1);
    return [ux, uy];
  }

  tick(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const { cx, cy, r } = this.dome();
    const w = this.water;

    w.t += dt;
    w.swirl *= Math.exp(-dt / 1.9);
    w.slosh *= Math.exp(-dt / 0.8);
    w.stir *= Math.exp(-dt / 1.6);

    // flakes catch up with the water quickly (they are tiny and light)
    const follow = 1 - Math.exp(-dt * 3.2);
    let moving = 0;

    for (const f of this.flakes) {
      if (f.settled) continue;
      moving++;

      const [ux, uy] = this.flow(f.x, f.y, cx, cy, r);
      const flutter = Math.sin(w.t * 2.3 + f.phase) * 0.012;
      f.vx += (ux + flutter - f.vx) * follow;
      f.vy += (uy + f.sink - f.vy) * follow;

      f.x += f.vx * dt;
      f.y += f.vy * dt;

      // Stay inside the glass
      const ox = f.x - cx;
      const oy = f.y - cy;
      const od = Math.hypot(ox, oy) || 1;
      const limit = r - f.r;
      if (od > limit) {
        const nx = ox / od;
        const ny = oy / od;
        f.x = cx + nx * limit;
        f.y = cy + ny * limit;
        const vn = f.vx * nx + f.vy * ny;
        if (vn > 0) {
          f.vx -= 1.3 * vn * nx;
          f.vy -= 1.3 * vn * ny;
        }
      }

      // Land on the mound once the water has calmed down there
      const ground = this.moundY(f.x);
      if (f.y >= ground - 0.004) {
        const [a, b] = this.moundSpan();
        f.x = Math.max(a, Math.min(b, f.x));
        if (f.vy > 0 && Math.hypot(ux, uy) < 0.2) {
          this.restOnMound(f, false);
        } else {
          f.y = ground - 0.004;
          if (f.vy > 0) f.vy *= -0.3;
        }
      }
    }

    this.draw();

    if (moving > 0) {
      requestAnimationFrame(t => this.tick(t));
    } else {
      this.active = false;
      w.swirl = w.slosh = w.stir = 0;
    }
  }

  draw() {
    const ctx = this.ctx;
    const W = this.W;
    ctx.clearRect(0, 0, W, this.H);
    // soft lilac edge so white flakes still show on white snow / photos
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(120, 128, 200, 0.45)";
    ctx.shadowBlur = 1.5;
    ctx.beginPath();
    for (const f of this.flakes) {
      const x = f.x * W;
      const y = f.y * W;
      const rad = Math.max(0.8, f.r * W);
      ctx.moveTo(x + rad, y);
      ctx.arc(x, y, rad, 0, Math.PI * 2);
    }
    ctx.globalAlpha = 0.95;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  // ---------- replaying the moments ----------

  async replay() {
    if (!this.canReplay) return;
    const run = ++this.runId;
    this.playing = true;
    this.emit();

    // Let the snow swirl a moment before the photos come alive
    await this.wait(700);

    const { times, duration } = this.memory;
    for (let i = 0; i < times.length; i++) {
      if (run !== this.runId) return;
      const length = Math.min(3, duration || 3);
      const start = Math.max(0, Math.min(times[i] - length / 2, (duration || 0) - length));
      const ok = await this.playClip(i, start, start + length, run);
      if (!ok) break;
    }

    if (run !== this.runId) return;
    this.playing = false;
    this.emit();
  }

  async playClip(index, start, end, run) {
    const v = this.video;
    const frame = this.frame;

    frame.className = "globe-video hole" + (index + 1);
    v.style.transform = this.memory.rotation ? `rotate(${this.memory.rotation}deg)` : "";

    await this.seek(start);
    if (run !== this.runId) return false;

    v.muted = this.muted;
    try {
      await v.play();
    } catch (error) {
      // Sound blocked: play silently instead of not at all
      v.muted = true;
      this.emit();
      try {
        await v.play();
      } catch (error2) {
        console.warn("Video could not play:", error2);
        return false;
      }
    }

    frame.classList.add("is-on");

    await new Promise(resolve => {
      const check = () => {
        if (run !== this.runId || v.ended || v.paused || v.currentTime >= end) {
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });

    frame.classList.remove("is-on");
    await this.wait(450); // fade back to the frozen photo
    v.pause();
    return run === this.runId;
  }

  seek(time) {
    const v = this.video;
    return new Promise(resolve => {
      const done = () => {
        v.removeEventListener("seeked", done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 3000);
      v.addEventListener("seeked", done);
      v.currentTime = time;
    });
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    this.runId++;
    this.playing = false;
    this.video.pause();
    this.frame.classList.remove("is-on");
    this.emit();
  }
};
