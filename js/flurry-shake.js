// Shake the snow globe!
//
// - Drag the globe left and right (mouse or touch), or call shake()
// - The globe tilts and wobbles, snow swirls inside the drawn glass dome
//   and slowly settles
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

  setupSnow() {
    this.flakes = [];
    this.active = false;
    this.energy = 0;
    const count = 150;
    for (let i = 0; i < count; i++) {
      this.flakes.push({ x: 0, y: 0, vx: 0, vy: 0, r: 0, a: 0, settled: true });
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.W = this.el.clientWidth;
      this.H = this.el.clientHeight;
      this.canvas.width = Math.round(this.W * dpr);
      this.canvas.height = Math.round(this.H * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(this.el);
  }

  dome() {
    const d = Flurry.GLOBE.dome;
    return {
      cx: d.cx * this.W,
      cy: d.cy * this.H,
      r: d.r * this.W * 0.94, // just inside the drawn outline
      floor: d.floor * this.H
    };
  }

  stir(strength, direction) {
    const { cx, cy, r, floor } = this.dome();
    const wasActive = this.active;
    this.energy = Math.min(1.4, this.energy + strength);
    const scale = this.W / 400;

    this.flakes.forEach(f => {
      if (!wasActive || f.settled) {
        // Lift flakes out of the snow pile at the bottom of the dome
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.sqrt(Math.random()) * r * 0.85;
        f.x = cx + Math.cos(angle) * dist;
        f.y = Math.min(floor - 4, Math.max(cy - r * 0.2, floor - Math.random() * r * 0.6));
        f.r = (Math.random() * 1.8 + 1.1) * scale;
        f.a = 0;
        f.settled = false;
      }
      const kick = this.reducedMotion ? 0.15 : 1;
      f.vx += ((Math.random() - 0.5) * 260 + direction * 160) * strength * kick * scale;
      f.vy += (-Math.random() * 300 - 40) * strength * kick * scale;
    });

    if (!this.active) {
      this.active = true;
      this.canvas.classList.add("is-on");
      this.last = performance.now();
      requestAnimationFrame(t => this.tick(t));
    }
  }

  tick(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const { cx, cy, r, floor } = this.dome();
    const scale = this.W / 400;
    const ctx = this.ctx;

    this.energy *= Math.exp(-dt / 1.6);
    const swirl = this.reducedMotion ? 0 : this.energy;
    let moving = 0;

    ctx.clearRect(0, 0, this.W, this.H);
    ctx.fillStyle = "#ffffff";

    for (const f of this.flakes) {
      if (f.settled && f.a <= 0) continue;

      if (!f.settled) {
        // Swirl around the centre of the dome, plus a little wobble
        const dx = f.x - cx;
        const dy = f.y - cy;
        const dist = Math.hypot(dx, dy) || 1;
        f.vx += (-dy / dist) * 220 * swirl * scale * dt;
        f.vy += (dx / dist) * 220 * swirl * scale * dt;
        f.vx += (Math.random() - 0.5) * 60 * scale * dt;

        // Gentle gravity and water-like drag: snow drifts down slowly
        f.vy += 120 * scale * dt;
        const drag = Math.exp(-dt * 2.2);
        f.vx *= drag;
        f.vy *= drag;

        f.x += f.vx * dt;
        f.y += f.vy * dt;

        // Bounce softly off the glass
        const ox = f.x - cx;
        const oy = f.y - cy;
        const od = Math.hypot(ox, oy);
        const limit = r - f.r;
        if (od > limit) {
          const nx = ox / od;
          const ny = oy / od;
          f.x = cx + nx * limit;
          f.y = cy + ny * limit;
          const vn = f.vx * nx + f.vy * ny;
          if (vn > 0) {
            f.vx -= 1.6 * vn * nx;
            f.vy -= 1.6 * vn * ny;
          }
        }

        // Land on the snow mound
        if (f.y > floor && f.vy > 0) {
          f.y = floor;
          f.settled = true;
        }

        f.a = Math.min(1, f.a + dt * 4);
        moving++;
      } else {
        f.a -= dt * 1.2; // settled flakes melt into the drawn snow
      }

      if (f.a > 0) {
        ctx.globalAlpha = Math.max(0, f.a) * 0.92;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    const visible = this.flakes.some(f => f.a > 0);
    if (moving > 0 || visible) {
      requestAnimationFrame(t => this.tick(t));
    } else {
      this.active = false;
      this.energy = 0;
      this.canvas.classList.remove("is-on");
      ctx.clearRect(0, 0, this.W, this.H);
    }
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
