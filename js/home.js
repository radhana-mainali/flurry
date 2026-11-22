// Homepage: upload a video -> pick 3 of 10 frames -> save a snow globe.

const upload = document.getElementById("upload");
const rotation = document.getElementById("rotation");
const status = document.getElementById("status");

const globe = document.getElementById("globe");
const globeButton = document.getElementById("snowglobeButton");
const holes = [
  document.getElementById("hole1"),
  document.getElementById("hole2"),
  document.getElementById("hole3")
];

const selectionArea = document.getElementById("selectionArea");
const gallery = document.getElementById("gallery");
const counter = document.getElementById("counter");
const done = document.getElementById("done");

const finalArea = document.getElementById("finalArea");
const back = document.getElementById("back");
const saveButton = document.getElementById("saveSnowglobe");

// Each candidate: { time, raw (upright-as-recorded JPEG Blob), url (shown, rotated) }
let candidates = [];
let selected = [];
let processing = false;
let currentFile = null;
let videoDuration = 0;
let stage_ = "idle"; // idle | choosing | finished
let videoUrl = null;     // kept for shake-to-replay before saving
let recordedOn = null;   // recording date from the file, if believable

const FRAME_SIZE = 1080; // max saved photo size in pixels

// Click globe to open file picker (only before a globe is finished)
globeButton.onclick = () => {
  if (processing || stage_ === "finished") return;
  upload.click();
};

// Calculate Laplacian variance sharpness
function sharpness(ctx, width, height) {
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);

  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    gray[i] = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
  }

  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += value;
      sumSquares += value * value;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

// Draw the centred square of a video frame (no rotation)
function drawSquare(source, ctx, canvas) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  const size = Math.min(width, height);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    source,
    (width - size) / 2, (height - size) / 2, size, size,
    0, 0, canvas.width, canvas.height
  );
}

// Seek to a timestamp, giving up if the browser can't decode the video
function seek(video, time) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("unsupported"));
    }, 20000);

    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("unsupported"));
    };

    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    }

    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = time;
  });
}

// Turn a raw square frame into the version shown, rotated by the dropdown
async function rotatedBlob(rawBlob, degrees) {
  if (!degrees) return rawBlob;
  const img = await Flurry.loadImage(URL.createObjectURL(rawBlob));
  URL.revokeObjectURL(img.src);

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(degrees * Math.PI / 180);
  ctx.drawImage(img, -canvas.width / 2, -canvas.height / 2);
  return Flurry.canvasToBlob(canvas, "image/jpeg", 0.92);
}

async function applyRotation() {
  const degrees = Number(rotation.value);
  for (const frame of candidates) {
    const blob = await rotatedBlob(frame.raw, degrees);
    if (frame.url) URL.revokeObjectURL(frame.url);
    frame.blob = blob;
    frame.url = URL.createObjectURL(blob);
  }
}

// Process uploaded video
async function processVideo() {
  const file = upload.files[0];
  // Clear the input so choosing the same file again still works
  upload.value = "";
  if (!file || processing) return;

  processing = true;
  rotation.disabled = true;
  globe.classList.add("is-busy");

  candidates.forEach(c => c.url && URL.revokeObjectURL(c.url));
  candidates = [];
  selected = [];
  currentFile = null;
  recordedOn = null;
  shaker.stop();
  shaker.enabled = false;
  clearDecorations();

  gallery.innerHTML = "";
  gallery.hidden = true;
  stickerTray.hidden = true;
  selectionArea.hidden = true;
  finalArea.hidden = true;
  stage.dataset.state = "idle";
  stage_ = "idle";
  updateGlobe();
  layoutFloaters();

  status.textContent = "Finding your best moments...";

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const url = URL.createObjectURL(file);

  try {
    video.src = url;

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("unsupported"));
      setTimeout(() => reject(new Error("unsupported")), 30000);
    });

    // Recorded WebM files often don't know their length until the end is read
    if (video.duration === Infinity) {
      await new Promise(resolve => {
        video.ondurationchange = () => {
          if (video.duration !== Infinity) resolve();
        };
        video.currentTime = 1e101;
        setTimeout(resolve, 5000);
      });
      video.ondurationchange = null;
    }

    const duration = video.duration;
    const size = Math.min(video.videoWidth, video.videoHeight);

    if (!Number.isFinite(duration) || duration <= 0 || size <= 0) {
      throw new Error("unsupported");
    }

    // Low-resolution sharpness canvas
    const scoreCanvas = document.createElement("canvas");
    scoreCanvas.width = 256;
    scoreCanvas.height = 256;
    const scoreCtx = scoreCanvas.getContext("2d", { willReadFrequently: true });

    // Full-resolution photo canvas
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = fullCanvas.height = Math.min(size, FRAME_SIZE);
    const fullCtx = fullCanvas.getContext("2d");

    const frames = [];

    // Analyze 30 frames
    for (let i = 0; i < 30; i++) {
      const time = duration * (i + 1) / 31;
      await seek(video, time);
      drawSquare(video, scoreCtx, scoreCanvas);
      frames.push({ time, score: sharpness(scoreCtx, 256, 256) });
      status.textContent = "Finding your best moments... " + Math.round((i + 1) / 30 * 100) + "%";
    }

    // Sharpest first, then pick 10 that are spread out in time
    frames.sort((a, b) => b.score - a.score);
    const chosen = [];
    for (const frame of frames) {
      const farEnough = chosen.every(other =>
        Math.abs(other.time - frame.time) >= duration * 0.06
      );
      if (farEnough) chosen.push(frame);
      if (chosen.length === 10) break;
    }
    for (const frame of frames) {
      if (chosen.length === 10) break;
      if (!chosen.includes(frame)) chosen.push(frame);
    }
    chosen.sort((a, b) => a.time - b.time);

    // Extract 10 full-quality photos
    for (const frame of chosen) {
      await seek(video, frame.time);
      drawSquare(video, fullCtx, fullCanvas);
      candidates.push({
        time: frame.time,
        raw: await Flurry.canvasToBlob(fullCanvas, "image/jpeg", 0.92)
      });
    }

    await applyRotation();

    currentFile = file;
    videoDuration = duration;
    recordedOn = await Flurry.readRecordingDate(file);

    stage.dataset.state = "choosing";
    stage_ = "choosing";
    selectionArea.hidden = false;
    displayGallery();
    status.textContent = "Pick your 3 favorite moments!";

  } catch (error) {
    console.error(error);
    stage_ = "idle";
    if (video.error) {
      console.warn("Video error", video.error.code, video.error.message, file.type, file.name);
    }
    status.textContent = error.message === "unsupported"
      ? "Hmm, this browser can't play that video's format (iPhone HDR videos often need Safari). Try opening Flurry in Safari, or pick a different video!"
      : "Something went wrong reading that video. Try again?";

  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
    rotation.disabled = false;
    globe.classList.remove("is-busy");
    processing = false;
  }
}

// ---------- things floating around the globe ----------

const stage = document.getElementById("globeStage");
const narrowScreen = matchMedia("(max-width: 640px)");

// Lay items out in two loose columns either side of the globe, like
// ( globe ). Ten frames on a wide screen go in two columns per side
// (3 + 2, staggered) so they can be bigger.
function layoutRing(ring, maxSize) {
  if (ring.hidden) return;
  const items = [...ring.children];
  if (!items.length) return;

  const sw = stage.clientWidth;
  const gw = globe.offsetWidth;
  const gh = globe.offsetHeight;
  const side = (sw - gw) / 2;
  const per = Math.ceil(items.length / 2);
  const room = Math.max(gh, narrowScreen.matches ? innerHeight * 0.58 : 0);

  // [column, row] slots for one side, in "item size" units
  const single = Array.from({ length: per }, (_, i) => [0, i - (per - 1) / 2]);
  const sizeSingle = Math.min(maxSize, side - 14, room / (per * 1.12));

  let slots = single;
  let size = sizeSingle;
  if (per === 5) {
    const stagger = [[0, -0.56], [0, 0.56], [0.98, -1.12], [0.98, 0], [0.98, 1.12]];
    const sizeStagger = Math.min(maxSize, (side - 16) / 1.98, room / (3.24 * 1.12));
    if (sizeStagger > sizeSingle) {
      slots = stagger;
      size = sizeStagger;
    }
  }
  size = Math.max(38, Math.floor(size));

  const rows = slots.map(s => s[1]);
  const span = (Math.max(...rows) - Math.min(...rows) + 1) * size * 1.12;
  const height = Math.max(gh, span);
  stage.style.height = height + "px";

  // top-to-bottom on the left, then top-to-bottom on the right
  const order = slots.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  items.forEach((item, i) => {
    const left = i < per;
    const [col, row] = order[left ? i : i - per] || [0, 0];
    // curve in a little at the top and bottom, like brackets round the globe
    const curve = slots === single ? -0.18 * row * row : 0;
    const dx = gw / 2 + 10 + size / 2 + (col + curve) * size;
    const x = sw / 2 + (left ? -dx : dx);
    const y = height / 2 + row * size * 1.12;
    item.style.width = item.style.height = size + "px";
    item.style.left = (x - size / 2) + "px";
    item.style.top = (y - size / 2) + "px";
  });
}

function layoutFloaters() {
  layoutRing(gallery, 132);
  layoutRing(stickerTray, 104);
  if (gallery.hidden && stickerTray.hidden) stage.style.height = "";
}

window.addEventListener("resize", layoutFloaters);
if (window.ResizeObserver) new ResizeObserver(layoutFloaters).observe(globe);

function floatItem(className) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "float-item " + className;
  // each one bobs gently at its own pace and tilt
  item.style.setProperty("--tilt", ((Math.random() - 0.5) * 14).toFixed(1) + "deg");
  item.style.setProperty("--bob-delay", (-Math.random() * 4).toFixed(2) + "s");
  item.style.setProperty("--bob-time", (3.4 + Math.random() * 1.6).toFixed(2) + "s");
  const bob = document.createElement("span");
  bob.className = "float-bob";
  item.appendChild(bob);
  return { item, bob };
}

// Display 10 image choices floating round the globe
function displayGallery() {
  gallery.innerHTML = "";
  candidates.forEach((frame, index) => {
    const { item, bob } = floatItem("float-frame");
    item.setAttribute("aria-label", "Moment " + (index + 1));
    const img = document.createElement("img");
    img.src = frame.url;
    img.alt = "";
    img.className = "photo";
    img.draggable = false;
    const badge = document.createElement("span");
    badge.className = "pick-badge";
    bob.append(img, badge);
    item.onclick = () => toggleFrame(index);
    gallery.appendChild(item);
  });
  gallery.hidden = false;
  layoutFloaters();
  updateSelection();
}

// Select or deselect a photo
function toggleFrame(index) {
  if (stage.dataset.busy) return;
  if (selected.includes(index)) {
    selected = selected.filter(i => i !== index);
  } else {
    if (selected.length >= 3) return;
    selected.push(index);
  }
  updateSelection();
}

// The photos sit in the globe's openings only once they're frozen in
function updateGlobe() {
  holes.forEach((hole, i) => {
    const frame = candidates[selected[i]];
    if (stage.dataset.state === "finished" && frame) {
      hole.src = frame.url;
      hole.style.display = "block";
    } else {
      hole.removeAttribute("src");
      hole.style.display = "none";
    }
  });
}

// Update selected glow, numbers and Done button
function updateSelection() {
  [...gallery.children].forEach((item, index) => {
    const pick = selected.indexOf(index);
    item.classList.toggle("selected", pick >= 0);
    item.setAttribute("aria-pressed", String(pick >= 0));
    item.querySelector(".pick-badge").textContent = pick >= 0 ? pick + 1 : "";
  });
  counter.textContent = selected.length + " / 3 picked";
  done.disabled = selected.length !== 3;
}

// ---------- photos flying into (and out of) the globe ----------

// Where an opening is on screen
function holeBox(i) {
  const g = globe.getBoundingClientRect();
  const h = Flurry.GLOBE.holes[i];
  return {
    x: g.left + (h.left + h.width / 2) * g.width,
    y: g.top + (h.top + h.height / 2) * g.height,
    size: h.width * g.width,
    rotate: h.rotate
  };
}

function itemBox(item) {
  const r = item.getBoundingClientRect();
  return {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    size: r.width,
    rotate: parseFloat(item.style.getPropertyValue("--tilt")) || 0
  };
}

// Float a copy of a photo from one place to another
function flyPhoto(src, from, to, delay) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.className = "flying-photo";
  Object.assign(img.style, {
    left: (to.x - to.size / 2) + "px",
    top: (to.y - to.size / 2) + "px",
    width: to.size + "px",
    height: to.size + "px"
  });
  document.body.appendChild(img);

  const k = from.size / to.size;
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const lift = Math.min(90, Math.hypot(dx, dy) * 0.3);
  const ms = reducedMotion ? 10 : 900;
  const anim = img.animate([
    { transform: `translate(${dx}px, ${dy}px) rotate(${from.rotate}deg) scale(${k})`, opacity: 1 },
    { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) rotate(${(from.rotate + to.rotate) / 2 + 8}deg) scale(${(k + 1) / 2 * 1.08})`, opacity: 1, offset: 0.5 },
    { transform: `translate(0, 0) rotate(${to.rotate}deg) scale(1)`, opacity: 1, offset: 0.88 },
    { transform: `translate(0, 0) rotate(${to.rotate}deg) scale(1)`, opacity: 0 }
  ], { duration: ms, delay: reducedMotion ? 0 : delay, easing: "cubic-bezier(0.45, 0, 0.3, 1)", fill: "both" });
  return anim.finished.then(() => img.remove(), () => img.remove());
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Finish selecting photos -> they float into the globe -> decorate & shake
done.onclick = async () => {
  if (selected.length !== 3 || stage.dataset.busy) return;
  stage.dataset.busy = "1";
  done.disabled = true;

  const items = [...gallery.children];
  const flights = selected.map((index, k) => {
    const item = items[index];
    const from = itemBox(item);
    item.classList.add("is-flying");
    // the photo appears in its opening just as the flying copy lands
    setTimeout(() => {
      const hole = holes[k];
      hole.src = candidates[index].url;
      hole.style.display = "block";
      hole.classList.add("is-landing");
    }, (reducedMotion ? 0 : 700 + k * 140));
    return flyPhoto(candidates[index].url, from, holeBox(k), k * 140);
  });
  items.forEach((item, i) => {
    if (!selected.includes(i)) item.classList.add("is-leaving");
  });

  await Promise.all(flights);
  holes.forEach(h => h.classList.remove("is-landing"));
  delete stage.dataset.busy;
  finishGlobe();
};

function finishGlobe() {
  stage.dataset.state = "finished";
  stage_ = "finished";
  updateGlobe();
  gallery.hidden = true;
  selectionArea.hidden = true;
  finalArea.hidden = false;
  stickerTray.hidden = false;
  layoutFloaters();
  globe.classList.add("is-shakeable");
  status.textContent = "Your moments are frozen! Decorate your globe, then shake it";

  if (!dateText.value) {
    dateText.value = Flurry.formatStampDate(recordedOn || new Date());
  }
  renderDate();

  showNameStep(false);

  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(currentFile);
  const picks = selected.map(i => candidates[i]);
  shaker.setMemory({
    videoUrl,
    times: picks.map(p => p.time),
    duration: videoDuration,
    rotation: Number(rotation.value)
  });
  shaker.enabled = true;
}

// Go back to frame selection: the photos float back out
back.onclick = async () => {
  if (stage.dataset.busy) return;
  stage.dataset.busy = "1";
  shaker.stop();
  shaker.enabled = false;
  globe.classList.remove("is-shakeable");
  selectSticker(null);

  const from = selected.map((_, k) => holeBox(k));
  stage.dataset.state = "choosing";
  stage_ = "choosing";
  naming = false;
  renderName();
  finalArea.hidden = true;
  stickerTray.hidden = true;
  selectionArea.hidden = false;
  status.textContent = "Pick your 3 favorite moments!";

  const items = [...gallery.children];
  items.forEach(item => item.classList.remove("is-leaving"));
  selected.forEach(index => items[index].classList.add("is-flying"));
  gallery.hidden = false;
  layoutFloaters();
  updateGlobe();

  await Promise.all(selected.map((index, k) =>
    flyPhoto(candidates[index].url, from[k], itemBox(items[index]), k * 100)
      .then(() => items[index].classList.remove("is-flying"))
  ));
  delete stage.dataset.busy;
  updateSelection();
};

// ---------- shaking ----------

const shakeButton = document.getElementById("shakeButton");

const shaker = new Flurry.ShakeGlobe(globe, {
  onStateChange: state => {
    shakeButton.textContent = state.playing ? "Stop" : "Shake";
    // Let the video's own sound be heard: fade the background music
    // while a clip plays with sound, bring it back afterwards
    if (Flurry.music) Flurry.music.duck(state.playing && !state.muted);
  }
});

shakeButton.onclick = () => {
  if (shaker.playing) {
    shaker.stop();
    return;
  }
  shaker.prime();
  shaker.shake(1, Math.random() < 0.5 ? -1 : 1);
};

// ---------- stickers ----------

const stickerLayer = document.getElementById("stickerLayer");
const stickerTray = document.getElementById("stickerTray");
let stickers = [];        // { id, x, y, width, rotate, el }
let activeSticker = null;

const MIN_STICKER = 0.07;
const MAX_STICKER = 0.6;

// The stickers float beside the globe. Drag one off ("peel" it) and drop
// it on the globe, or just click it to stick it in its usual spot.
Flurry.STICKERS.forEach(def => {
  const { item, bob } = floatItem("float-sticker");
  item.title = "Peel off the " + def.label.toLowerCase();
  item.setAttribute("aria-label", "Add " + def.label.toLowerCase() + " sticker");
  const img = document.createElement("img");
  img.src = def.src;
  img.alt = "";
  img.draggable = false;
  bob.appendChild(img);
  makePeelable(item, def);
  stickerTray.appendChild(item);
});

function makePeelable(item, def) {
  let ghost = null;
  let startX = 0;
  let startY = 0;
  let peeled = false;
  let skipClick = false;

  item.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    startX = event.clientX;
    startY = event.clientY;
    peeled = false;
    item.setPointerCapture(event.pointerId);
  });

  item.addEventListener("pointermove", event => {
    if (!item.hasPointerCapture(event.pointerId)) return;
    if (!peeled && Math.hypot(event.clientX - startX, event.clientY - startY) < 6) return;
    if (!peeled) {
      peeled = true;
      // a fresh copy lifts off the sheet and follows your finger
      ghost = document.createElement("img");
      ghost.src = def.src;
      ghost.alt = "";
      ghost.className = "peel-ghost";
      ghost.style.width = def.width * globe.offsetWidth + "px";
      document.body.appendChild(ghost);
      item.classList.add("is-peeled");
    }
    ghost.style.left = event.clientX + "px";
    ghost.style.top = event.clientY + "px";
  });

  const finish = event => {
    if (!item.hasPointerCapture(event.pointerId)) return;
    item.releasePointerCapture(event.pointerId);
    item.classList.remove("is-peeled");
    if (!peeled) return;           // a plain click: handled below
    skipClick = true;

    const box = globe.getBoundingClientRect();
    const fx = (event.clientX - box.left) / box.width;
    const fy = (event.clientY - box.top) / box.height;
    const onGlobe = event.type === "pointerup" && fx > 0 && fx < 1 && fy > 0 && fy < 1;

    if (onGlobe) {
      ghost.remove();
      addSticker(def, { x: fx, y: fy });
    } else {
      // dropped off the globe: it floats back onto the sheet
      const home = item.getBoundingClientRect();
      const g = ghost;
      g.animate([
        { transform: "translate(-50%, -50%) rotate(-8deg) scale(1.1)" },
        { transform: `translate(calc(-50% + ${home.left + home.width / 2 - event.clientX}px), calc(-50% + ${home.top + home.height / 2 - event.clientY}px)) scale(0.6)`, opacity: 0 }
      ], { duration: reducedMotion ? 10 : 350, easing: "ease-in", fill: "forwards" })
        .finished.then(() => g.remove(), () => g.remove());
    }
    ghost = null;
  };
  item.addEventListener("pointerup", finish);
  item.addEventListener("pointercancel", finish);

  // click / Enter / Space: stick it on in its usual spot
  item.addEventListener("click", () => {
    if (skipClick) {
      skipClick = false;
      return;
    }
    addSticker(def);
  });
}

function clampSticker(s) {
  s.width = Math.min(MAX_STICKER, Math.max(MIN_STICKER, s.width));
  const half = Math.min(s.width / 2, 0.3);
  s.x = Math.min(1 - half, Math.max(half, s.x));
  s.y = Math.min(0.95, Math.max(0.05, s.y));
}

function addSticker(def, at) {
  if (stickers.length >= 12) return;
  // Start at this sticker's spot; repeats of the same sticker shift a bit
  const repeats = stickers.filter(x => x.id === def.id).length;
  const s = {
    id: def.id,
    x: at ? at.x : def.spot.x + repeats * 0.06 * (def.spot.x > 0.5 ? -1 : 1),
    y: at ? at.y : def.spot.y + repeats * 0.05,
    width: def.width,
    rotate: Math.round((Math.random() - 0.5) * 20)
  };
  clampSticker(s);
  s.el = Flurry.stickerElement(s);
  s.el.tabIndex = 0;
  s.el.classList.add("just-stuck");
  s.el.addEventListener("animationend", () => s.el.classList.remove("just-stuck"), { once: true });
  s.el.addEventListener("load", () => { if (activeSticker === s) positionControls(); });
  stickerLayer.appendChild(s.el);
  stickers.push(s);
  makeDraggable(s);
  selectSticker(s);
}

// Controls on the chosen sticker: "x" to remove, a dot to resize / turn
function control(className, text, label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  b.setAttribute("aria-label", label);
  b.hidden = true;
  stickerLayer.appendChild(b);
  return b;
}

const removeButton = control("sticker-remove", "×", "Remove sticker");
const turnHandle = control("sticker-turn", "↻", "Drag to resize or turn the sticker");
turnHandle.title = "drag to resize or turn";
turnHandle.tabIndex = -1;

removeButton.addEventListener("pointerdown", event => event.stopPropagation());
removeButton.onclick = event => {
  event.stopPropagation();
  removeSticker(activeSticker);
};

function removeSticker(s) {
  if (!s) return;
  s.el.remove();
  stickers = stickers.filter(x => x !== s);
  selectSticker(null);
}

function selectSticker(s) {
  activeSticker = s;
  stickers.forEach(x => x.el.classList.toggle("is-selected", x === s));
  removeButton.hidden = turnHandle.hidden = !s;
  if (s) positionControls();
}

// A corner of the (turned) sticker, as % of the globe
function stickerCorner(s, sx, sy) {
  const W = globe.offsetWidth;
  const H = globe.offsetHeight;
  const w = s.width * W;
  const h = s.el.offsetHeight || w;
  const a = (s.rotate || 0) * Math.PI / 180;
  const lx = sx * w / 2;
  const ly = sy * h / 2;
  const x = s.x * W + lx * Math.cos(a) - ly * Math.sin(a);
  const y = s.y * H + lx * Math.sin(a) + ly * Math.cos(a);
  const clamp = v => Math.min(96, Math.max(4, v));
  return [clamp(x / W * 100) + "%", clamp(y / H * 100) + "%"];
}

function positionControls() {
  const s = activeSticker;
  if (!s) return;
  [removeButton.style.left, removeButton.style.top] = stickerCorner(s, 1, -1);
  [turnHandle.style.left, turnHandle.style.top] = stickerCorner(s, 1, 1);
}

function updateSticker(s) {
  clampSticker(s);
  Flurry.placeSticker(s.el, s);
  positionControls();
}

// Drag the dot: further from the middle = bigger, round = turn
turnHandle.addEventListener("pointerdown", event => {
  const s = activeSticker;
  if (!s) return;
  event.stopPropagation();
  event.preventDefault();
  const box = globe.getBoundingClientRect();
  const cx = box.left + s.x * box.width;
  const cy = box.top + s.y * box.height;
  const d0 = Math.hypot(event.clientX - cx, event.clientY - cy) || 1;
  const a0 = Math.atan2(event.clientY - cy, event.clientX - cx);
  const w0 = s.width;
  const r0 = s.rotate || 0;
  turnHandle.setPointerCapture(event.pointerId);
  s.el.classList.add("is-dragging");

  const move = e => {
    const d = Math.hypot(e.clientX - cx, e.clientY - cy);
    const a = Math.atan2(e.clientY - cy, e.clientX - cx);
    s.width = w0 * d / d0;
    s.rotate = Math.round(r0 + (a - a0) * 180 / Math.PI);
    updateSticker(s);
  };
  const up = () => {
    s.el.classList.remove("is-dragging");
    turnHandle.removeEventListener("pointermove", move);
    turnHandle.removeEventListener("pointerup", up);
    turnHandle.removeEventListener("pointercancel", up);
  };
  turnHandle.addEventListener("pointermove", move);
  turnHandle.addEventListener("pointerup", up);
  turnHandle.addEventListener("pointercancel", up);
});

function makeDraggable(s) {
  let offsetX = 0;
  let offsetY = 0;

  s.el.addEventListener("pointerdown", event => {
    event.stopPropagation(); // don't shake the globe while placing stickers
    event.preventDefault();
    selectSticker(s);
    const box = globe.getBoundingClientRect();
    offsetX = (event.clientX - box.left) / box.width - s.x;
    offsetY = (event.clientY - box.top) / box.height - s.y;
    s.el.setPointerCapture(event.pointerId);
    s.el.classList.add("is-dragging");
  });

  s.el.addEventListener("pointermove", event => {
    if (!s.el.hasPointerCapture(event.pointerId)) return;
    const box = globe.getBoundingClientRect();
    s.x = (event.clientX - box.left) / box.width - offsetX;
    s.y = (event.clientY - box.top) / box.height - offsetY;
    updateSticker(s);
  });

  const end = () => s.el.classList.remove("is-dragging");
  s.el.addEventListener("pointerup", end);
  s.el.addEventListener("pointercancel", end);

  // Scroll over a sticker to resize it
  s.el.addEventListener("wheel", event => {
    event.preventDefault();
    selectSticker(s);
    s.width *= Math.exp(-event.deltaY * 0.0015);
    updateSticker(s);
  }, { passive: false });

  // Keyboard: arrows move, + / - resize, [ / ] turn, Delete removes
  s.el.addEventListener("keydown", event => {
    const step = 0.02;
    if (event.key === "Delete" || event.key === "Backspace") {
      removeSticker(s);
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowLeft") s.x -= step;
    else if (event.key === "ArrowRight") s.x += step;
    else if (event.key === "ArrowUp") s.y -= step;
    else if (event.key === "ArrowDown") s.y += step;
    else if (event.key === "+" || event.key === "=") s.width *= 1.08;
    else if (event.key === "-" || event.key === "_") s.width /= 1.08;
    else if (event.key === "]") s.rotate = (s.rotate || 0) + 5;
    else if (event.key === "[") s.rotate = (s.rotate || 0) - 5;
    else return;
    event.preventDefault();
    updateSticker(s);
  });
  s.el.addEventListener("focus", () => selectSticker(s));
}

// Clicking anywhere else deselects
document.addEventListener("pointerdown", event => {
  if (activeSticker && !stickerLayer.contains(event.target)) selectSticker(null);
});

// ---------- date stamp ----------

const dateLayer = document.getElementById("dateLayer");
const dateOn = document.getElementById("dateOn");
const dateText = document.getElementById("dateText");

function renderDate() {
  dateLayer.innerHTML = "";
  dateText.disabled = !dateOn.checked;
  if (dateOn.checked && dateText.value.trim()) {
    dateLayer.appendChild(Flurry.dateStampElement({ text: dateText.value.trim() }));
  }
}

dateOn.addEventListener("change", renderDate);
dateText.addEventListener("input", renderDate);

// ---------- naming the memory (the last step) ----------

const decorateStep = document.getElementById("decorateStep");
const nameStep = document.getElementById("nameStep");
const memoryName = document.getElementById("memoryName");
let naming = false;
let plate = null;        // the nameplate canvas on the globe
let plateToken = 0;

function currentName() {
  return Flurry.cleanName(memoryName.value) || Flurry.DEFAULT_NAME;
}

// The plate shows while naming, and stays once a name has been typed
async function renderName() {
  const token = ++plateToken;
  const show = stage_ === "finished" && (naming || Flurry.cleanName(memoryName.value));
  if (!show) {
    if (plate) plate.remove();
    plate = null;
    return;
  }
  const el = Flurry.nameplateElement(currentName());
  await el.ready;
  if (token !== plateToken) return;   // typed again meanwhile
  if (plate) plate.remove();
  else el.classList.add("is-new");
  plate = el;
  globe.appendChild(el);
}

function showNameStep(on) {
  naming = on;
  selectSticker(null);
  decorateStep.hidden = on;
  nameStep.hidden = !on;
  stickerTray.hidden = on;
  layoutFloaters();
  status.textContent = on
    ? "Last step: give your snow globe a name!"
    : "Your moments are frozen! Decorate your globe, then shake it";
  renderName();
  // (no automatic focus on phones, so the keyboard doesn't jump up)
  if (on && matchMedia("(pointer: fine)").matches) memoryName.focus({ preventScroll: true });
}

document.getElementById("nameNext").onclick = () => {
  shaker.stop();
  showNameStep(true);
};
document.getElementById("backToDecorate").onclick = () => showNameStep(false);
memoryName.addEventListener("input", renderName);
memoryName.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveButton.click();
  }
});

function clearDecorations() {
  stickers.forEach(s => s.el.remove());
  stickers = [];
  selectSticker(null);
  dateText.value = "";
  dateOn.checked = true;
  renderDate();
  memoryName.value = "";
  naming = false;
  decorateStep.hidden = false;
  nameStep.hidden = true;
  renderName();
  globe.classList.remove("is-shakeable");
}

// Everything needed to draw this globe (photos, stickers, date, name)
async function currentDesign() {
  const photos = await Promise.all(holes.map(h => h.decode().then(() => h)));
  return {
    photos,
    stickers: stickers.map(({ id, x, y, width, rotate }) => ({ id, x, y, width, rotate })),
    date: { on: dateOn.checked, text: dateText.value.trim() },
    name: currentName()
  };
}

// Save completed globe
saveButton.onclick = async () => {
  if (selected.length !== 3 || saveButton.disabled) return;

  saveButton.disabled = true;
  shaker.stop();
  selectSticker(null);
  status.textContent = "Saving your snow globe...";

  try {
    const design = await currentDesign();
    const canvas = await Flurry.composeGlobe(design, 1);
    const thumb = await Flurry.canvasToBlob(canvas, "image/png");
    const picks = selected.map(i => candidates[i]);

    const memory = {
      id: "m" + Date.now(),
      createdAt: new Date().toISOString(),
      thumb,
      photos: picks.map(p => p.blob),
      times: picks.map(p => p.time),
      duration: videoDuration,
      rotation: Number(rotation.value),
      stickers: design.stickers,
      date: design.date,
      name: design.name
    };

    // a little pink glow while it's tucked away on the shelf
    globe.classList.add("is-saved");
    const [result] = await Promise.all([
      Flurry.store.save(memory, currentFile),
      new Promise(resolve => setTimeout(resolve, reducedMotion ? 200 : 1300))
    ]);

    if (!result.videoSaved && result.reason) {
      alert(result.reason === "size"
        ? "Your snow globe is saved! This video is too big to keep for shake-to-replay, so it's saved as a still keepsake."
        : "Your snow globe is saved! Your browser didn't have room for the video, so it's saved as a still keepsake.");
    }

    window.location.href = "./shelf.html?saved=" + memory.id;

  } catch (error) {
    console.error(error);
    globe.classList.remove("is-saved");
    status.textContent = "Could not save snow globe. Try again?";
    saveButton.disabled = false;
  }
};

upload.addEventListener("change", processVideo);

rotation.addEventListener("change", async () => {
  if (!candidates.length) return;
  rotation.disabled = true;
  await applyRotation();
  // keep the picks when the photos are turned
  const keep = selected;
  displayGallery();
  selected = keep;
  updateSelection();
  updateGlobe();
  rotation.disabled = false;
});

// Falling snow animation (background)
for (let i = 0; i < 60; i++) {
  const snowflake = document.createElement("div");
  snowflake.className = "snowflake";

  const size = Math.random() * 5 + 2;
  const duration = Math.random() * 8 + 6;

  snowflake.style.width = size + "px";
  snowflake.style.height = size + "px";
  snowflake.style.left = Math.random() * 100 + "vw";
  snowflake.style.animationDuration = duration + "s";
  snowflake.style.animationDelay = -Math.random() * duration + "s";
  snowflake.style.opacity = Math.random() * 0.5 + 0.5;

  document.body.appendChild(snowflake);
}
