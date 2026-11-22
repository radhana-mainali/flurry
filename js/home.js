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
let stage = "idle"; // idle | choosing | finished
let videoUrl = null;     // kept for shake-to-replay before saving
let recordedOn = null;   // recording date from the file, if believable

const FRAME_SIZE = 1080; // max saved photo size in pixels

// Click globe to open file picker (only before a globe is finished)
globeButton.onclick = () => {
  if (processing || stage === "finished") return;
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
  selectionArea.hidden = true;
  finalArea.hidden = true;
  updateGlobe();

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

    displayGallery();
    stage = "choosing";
    selectionArea.hidden = false;
    status.textContent = "Pick your favorite 3!";

  } catch (error) {
    console.error(error);
    stage = "idle";
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

// Display 10 image choices
function displayGallery() {
  gallery.innerHTML = "";
  candidates.forEach((frame, index) => {
    const img = document.createElement("img");
    img.src = frame.url;
    img.alt = "Moment " + (index + 1);
    img.className = "photo";
    img.tabIndex = 0;
    img.onclick = () => toggleFrame(index);
    img.onkeydown = event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleFrame(index);
      }
    };
    gallery.appendChild(img);
  });
  updateSelection();
}

// Select or deselect a photo
function toggleFrame(index) {
  if (selected.includes(index)) {
    selected = selected.filter(i => i !== index);
  } else {
    if (selected.length >= 3) return;
    selected.push(index);
  }
  updateSelection();
  updateGlobe();
}

// Put three selected images in globe holes
function updateGlobe() {
  holes.forEach((hole, i) => {
    const frame = candidates[selected[i]];
    if (i < selected.length && frame) {
      hole.src = frame.url;
      hole.style.display = "block";
    } else {
      hole.removeAttribute("src");
      hole.style.display = "none";
    }
  });
}

// Update selected borders and Done button
function updateSelection() {
  gallery.querySelectorAll("img").forEach((img, index) => {
    img.classList.toggle("selected", selected.includes(index));
    img.setAttribute("aria-pressed", selected.includes(index));
  });
  counter.textContent = selected.length + " / 3 selected";
  done.disabled = selected.length !== 3;
}

// Finish selecting photos -> decorate & shake
done.onclick = () => {
  if (selected.length !== 3) return;
  updateGlobe();
  stage = "finished";
  selectionArea.hidden = true;
  finalArea.hidden = false;
  globe.classList.add("is-shakeable");
  status.textContent = "Your moments are frozen! Decorate your globe, then shake it ❄️";

  if (!dateText.value) {
    dateText.value = Flurry.formatStampDate(recordedOn || new Date());
  }
  renderDate();

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
};

// Go back to frame selection
back.onclick = () => {
  stage = "choosing";
  shaker.stop();
  shaker.enabled = false;
  globe.classList.remove("is-shakeable");
  selectSticker(null);
  finalArea.hidden = true;
  selectionArea.hidden = false;
  status.textContent = "Pick your favorite 3!";
};

// ---------- shaking ----------

const shakeButton = document.getElementById("shakeButton");
const soundButton = document.getElementById("soundButton");

const shaker = new Flurry.ShakeGlobe(globe, {
  onStateChange: state => {
    shakeButton.textContent = state.playing ? "Stop" : "Shake ❄️";
    soundButton.hidden = !state.canReplay;
    // The button says what clicking it will do
    soundButton.textContent = state.muted ? "turn sound on" : "mute sound";
    soundButton.setAttribute("aria-pressed", String(state.muted));
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

soundButton.onclick = () => shaker.toggleMuted();

// ---------- stickers ----------

const stickerLayer = document.getElementById("stickerLayer");
const stickerTray = document.getElementById("stickerTray");
let stickers = [];        // { id, x, y, width, rotate, el }
let activeSticker = null;

Flurry.STICKERS.forEach(def => {
  const button = document.createElement("button");
  button.className = "sticker-choice";
  button.title = "Add " + def.label.toLowerCase();
  button.setAttribute("aria-label", "Add " + def.label.toLowerCase() + " sticker");
  const img = document.createElement("img");
  img.src = def.src;
  img.alt = "";
  button.appendChild(img);
  button.onclick = () => addSticker(def);
  stickerTray.appendChild(button);
});

function addSticker(def) {
  if (stickers.length >= 12) return;
  // Start at this sticker's spot; repeats of the same sticker shift a bit
  const repeats = stickers.filter(x => x.id === def.id).length;
  const s = {
    id: def.id,
    x: Math.min(0.9, Math.max(0.1, def.spot.x + repeats * 0.06 * (def.spot.x > 0.5 ? -1 : 1))),
    y: Math.min(0.9, def.spot.y + repeats * 0.05),
    width: def.width,
    rotate: Math.round((Math.random() - 0.5) * 20)
  };
  s.el = Flurry.stickerElement(s);
  s.el.tabIndex = 0;
  stickerLayer.appendChild(s.el);
  stickers.push(s);
  makeDraggable(s);
  selectSticker(s);
}

// Small "x" that appears on the chosen sticker
const removeButton = document.createElement("button");
removeButton.className = "sticker-remove";
removeButton.textContent = "×";
removeButton.setAttribute("aria-label", "Remove sticker");
removeButton.hidden = true;
stickerLayer.appendChild(removeButton);

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
  removeButton.hidden = !s;
  if (s) positionRemoveButton();
}

function positionRemoveButton() {
  const s = activeSticker;
  const box = globe.getBoundingClientRect();
  const h = s.el.offsetHeight / box.height;
  removeButton.style.left = ((s.x + s.width / 2) * 100) + "%";
  removeButton.style.top = ((s.y - h / 2) * 100) + "%";
}

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
    const halfW = s.width / 2;
    const halfH = s.el.offsetHeight / box.height / 2;
    // keep the whole sticker on the globe
    s.x = Math.min(1 - halfW, Math.max(halfW, (event.clientX - box.left) / box.width - offsetX));
    s.y = Math.min(1 - halfH, Math.max(halfH, (event.clientY - box.top) / box.height - offsetY));
    Flurry.placeSticker(s.el, s);
    positionRemoveButton();
  });

  const end = () => s.el.classList.remove("is-dragging");
  s.el.addEventListener("pointerup", end);
  s.el.addEventListener("pointercancel", end);

  s.el.addEventListener("keydown", event => {
    const step = 0.02;
    if (event.key === "Delete" || event.key === "Backspace") removeSticker(s);
    else if (event.key === "ArrowLeft") s.x = Math.max(s.width / 2, s.x - step);
    else if (event.key === "ArrowRight") s.x = Math.min(1 - s.width / 2, s.x + step);
    else if (event.key === "ArrowUp") s.y = Math.max(0.05, s.y - step);
    else if (event.key === "ArrowDown") s.y = Math.min(0.95, s.y + step);
    else return;
    event.preventDefault();
    if (stickers.includes(s)) {
      Flurry.placeSticker(s.el, s);
      positionRemoveButton();
    }
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

function clearDecorations() {
  stickers.forEach(s => s.el.remove());
  stickers = [];
  selectSticker(null);
  dateText.value = "";
  dateOn.checked = true;
  renderDate();
  globe.classList.remove("is-shakeable");
}

// Everything needed to draw this globe (photos, stickers, date)
async function currentDesign() {
  const photos = await Promise.all(holes.map(h => h.decode().then(() => h)));
  return {
    photos,
    stickers: stickers.map(({ id, x, y, width, rotate }) => ({ id, x, y, width, rotate })),
    date: { on: dateOn.checked, text: dateText.value.trim() }
  };
}

// Save completed globe
saveButton.onclick = async () => {
  if (selected.length !== 3) return;

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
      date: design.date
    };

    const result = await Flurry.store.save(memory, currentFile);

    if (!result.videoSaved && result.reason) {
      alert(result.reason === "size"
        ? "Your snow globe is saved! This video is too big to keep for shake-to-replay, so it's saved as a still keepsake."
        : "Your snow globe is saved! Your browser didn't have room for the video, so it's saved as a still keepsake.");
    }

    window.location.href = "./shelf.html?saved=" + memory.id;

  } catch (error) {
    console.error(error);
    status.textContent = "Could not save snow globe. Try again?";
    saveButton.disabled = false;
  }
};

upload.addEventListener("change", processVideo);

rotation.addEventListener("change", async () => {
  if (!candidates.length) return;
  rotation.disabled = true;
  await applyRotation();
  displayGallery();
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
