// My Shelf: show saved snow globes, 3 per plank, 9 per shelf page.

const rows = [
  document.getElementById("shelfRow1"),
  document.getElementById("shelfRow2"),
  document.getElementById("shelfRow3")
];

const viewer = document.getElementById("memoryViewer");
const largeGlobe = document.getElementById("largeGlobe");
const memoryDate = document.getElementById("memoryDate");

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

function openMemory(memory, src) {
  largeGlobe.src = src;
  memoryDate.textContent = memory.createdAt
    ? new Date(memory.createdAt).toLocaleDateString(undefined, {
        year: "numeric", month: "long", day: "numeric"
      })
    : "";
  viewer.hidden = false;
  document.getElementById("closeViewer").focus();
}

function closeMemory() {
  viewer.hidden = true;
}

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
