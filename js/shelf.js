// My Shelf: show saved snow globes, 3 per plank, 9 per shelf page.

const rows = [
  document.getElementById("shelfRow1"),
  document.getElementById("shelfRow2"),
  document.getElementById("shelfRow3")
];

const viewer = document.getElementById("memoryViewer");
const viewerGlobe = document.getElementById("viewerGlobe");
const memoryDate = document.getElementById("memoryDate");
const replayNote = document.getElementById("replayNote");
const viewerShake = document.getElementById("viewerShake");
const viewerSound = document.getElementById("viewerSound");

const pager = document.getElementById("shelfPager");
const prevShelf = document.getElementById("prevShelf");
const nextShelf = document.getElementById("nextShelf");
const pageLabel = document.getElementById("pageLabel");

const PER_SHELF = 9;

let memories = [];
let page = 0;
let objectUrls = [];

function thumbUrl(memory) {
  if (memory.legacy) return memory.image;
  const url = URL.createObjectURL(memory.thumb);
  objectUrls.push(url);
  return url;
}

function pageCount() {
  return Math.max(1, Math.ceil(memories.length / PER_SHELF));
}

// ---------- enlarged, shakeable globe ----------

const shaker = new Flurry.ShakeGlobe(viewerGlobe, {
  onStateChange: state => {
    viewerShake.textContent = state.playing ? "Stop" : "Shake ❄️";
    viewerSound.hidden = !state.canReplay;
    // The button says what clicking it will do
    viewerSound.textContent = state.muted ? "turn sound on" : "mute sound";
    viewerSound.setAttribute("aria-pressed", String(state.muted));
  }
});
shaker.enabled = true;

let viewerUrls = [];
let openToken = 0;

function viewerUrl(blob) {
  const url = URL.createObjectURL(blob);
  viewerUrls.push(url);
  return url;
}

function addLayer(el) {
  el.dataset.layer = "memory";
  // memory layers go underneath the snow + video that ShakeGlobe owns
  viewerGlobe.insertBefore(el, viewerGlobe.firstChild);
}

async function openMemory(memory, src) {
  const token = ++openToken;
  shaker.setMemory(null);
  viewerGlobe.querySelectorAll("[data-layer]").forEach(el => el.remove());
  viewerUrls.forEach(URL.revokeObjectURL);
  viewerUrls = [];

  const layers = [];

  if (memory.legacy || !memory.photos) {
    // Older saved globe: one flattened picture
    const img = document.createElement("img");
    img.src = src;
    img.alt = "Saved snow globe";
    img.className = "globe-art";
    layers.push(img);
  } else {
    memory.photos.forEach((blob, i) => {
      const img = document.createElement("img");
      img.src = viewerUrl(blob);
      img.alt = "";
      img.className = "globe-photo hole" + (i + 1);
      img.style.display = "block";
      layers.push(img);
    });

    const art = document.createElement("img");
    art.src = Flurry.GLOBE.art;
    art.alt = "Snow globe";
    art.className = "globe-art";
    layers.push(art);

    const dateLayer = document.createElement("div");
    dateLayer.className = "date-layer";
    if (memory.date && memory.date.on && memory.date.text) {
      dateLayer.appendChild(Flurry.dateStampElement(memory.date));
    }
    layers.push(dateLayer);
  }

  // photos, art and date go below the video/snow layers
  layers.reverse().forEach(addLayer);

  if (memory.stickers && memory.stickers.length) {
    const stickerLayer = document.createElement("div");
    stickerLayer.className = "sticker-layer";
    stickerLayer.dataset.layer = "memory";
    memory.stickers.forEach(s => {
      const el = Flurry.stickerElement(s);
      el.style.pointerEvents = "none";
      stickerLayer.appendChild(el);
    });
    viewerGlobe.appendChild(stickerLayer);
  }

  memoryDate.textContent = memory.date && memory.date.on && memory.date.text
    ? memory.date.text
    : memory.createdAt
      ? new Date(memory.createdAt).toLocaleDateString(undefined, {
          year: "numeric", month: "long", day: "numeric"
        })
      : "";

  replayNote.hidden = true;
  viewer.hidden = false;
  document.getElementById("closeViewer").focus();

  // Load the video for shake-to-replay
  if (!memory.legacy && memory.hasVideo) {
    try {
      const blob = await Flurry.store.getVideo(memory.id);
      if (token !== openToken) return;
      if (blob) {
        shaker.setMemory({
          videoUrl: viewerUrl(blob),
          times: memory.times,
          duration: memory.duration,
          rotation: memory.rotation || 0
        });
        return;
      }
    } catch (error) {
      console.error("Could not load video:", error);
    }
  }
  if (token === openToken) replayNote.hidden = false;
}

function closeMemory() {
  if (viewer.hidden) return;
  openToken++;
  shaker.setMemory(null);
  viewer.hidden = true;
}

viewerShake.onclick = () => {
  if (shaker.playing) {
    shaker.stop();
    return;
  }
  shaker.prime();
  shaker.shake(1, Math.random() < 0.5 ? -1 : 1);
};

viewerSound.onclick = () => shaker.toggleMuted();

function displayShelf() {
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
  rows.forEach(row => row.innerHTML = "");

  document.getElementById("emptyMessage").hidden = memories.length !== 0;

  page = Math.min(Math.max(page, 0), pageCount() - 1);
  pager.hidden = memories.length <= PER_SHELF;
  prevShelf.disabled = page === 0;
  nextShelf.disabled = page === pageCount() - 1;
  pageLabel.textContent = "shelf " + (page + 1) + " of " + pageCount();

  const start = page * PER_SHELF;

  memories.slice(start, start + PER_SHELF).forEach((memory, index) => {
    // 0,1,2 -> top shelf, 3,4,5 -> middle, 6,7,8 -> bottom
    const rowIndex = Math.floor(index / 3);
    const src = thumbUrl(memory);

    const img = document.createElement("img");
    img.src = src;
    img.alt = "Saved snow globe " + (start + index + 1);
    img.className = "saved-globe";
    img.tabIndex = 0;
    img.setAttribute("role", "button");

    img.onclick = () => openMemory(memory, src);
    img.onkeydown = event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMemory(memory, src);
      }
    };

    rows[rowIndex].appendChild(img);
  });
}

prevShelf.onclick = () => { page--; displayShelf(); };
nextShelf.onclick = () => { page++; displayShelf(); };

// Reset all saved snow globes (and their videos)
document.getElementById("resetShelf").onclick = async () => {
  if (memories.length === 0) return;

  const confirmed = confirm(
    "Delete all " + memories.length + " saved snow globe" +
    (memories.length === 1 ? "" : "s") +
    " and their videos? This cannot be undone."
  );
  if (!confirmed) return;

  try {
    await Flurry.store.clearAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't clear the shelf. Try again?");
  }

  memories = await Flurry.store.list();
  page = 0;
  closeMemory();
  displayShelf();
};

document.getElementById("closeViewer").onclick = closeMemory;

viewer.onclick = event => {
  if (event.target === viewer) closeMemory();
};

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeMemory();
});

(async () => {
  memories = await Flurry.store.list();

  // Open the shelf page holding the newest globe
  page = pageCount() - 1;
  const saved = new URLSearchParams(location.search).get("saved");
  if (saved) {
    const index = memories.findIndex(m => m.id === saved);
    if (index >= 0) page = Math.floor(index / PER_SHELF);
  }

  displayShelf();
})();
