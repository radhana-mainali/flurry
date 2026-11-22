// Memory storage for Flurry.
//
// New memories live in IndexedDB (database "flurry"):
//   memories: { id, createdAt, thumb (PNG Blob), photos [3 JPEG Blobs],
//               times [3 seconds], rotation, stickers, date,
//               hasVideo, videoType, duration }
//   videos:   id -> original video Blob (kept separate so the shelf
//             can list memories without loading any video)
//
// Older memories saved before IndexedDB are in localStorage under
// "flurryMemories" as { id, image (PNG data URL), createdAt }.
// They are read as-is and never modified, only removed by Reset Shelf.

window.Flurry = window.Flurry || {};

Flurry.MAX_VIDEO_BYTES = 200 * 1024 * 1024;

Flurry.store = (() => {
  const DB_NAME = "flurry";
  const LEGACY_KEY = "flurryMemories";
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("This browser can't store snow globes."));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("memories")) {
          db.createObjectStore("memories", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("videos")) {
          db.createObjectStore("videos");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Storage was interrupted"));
    });
  }

  function readLegacy() {
    try {
      const list = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
      if (!Array.isArray(list)) return [];
      return list
        .filter(m => m && typeof m.image === "string")
        .map(m => ({ ...m, legacy: true, hasVideo: false }));
    } catch (error) {
      console.error("Could not read older memories:", error);
      return [];
    }
  }

  // All memories, oldest first (so the first globe sits top-left)
  async function list() {
    const legacy = readLegacy();
    let modern = [];
    try {
      const db = await open();
      modern = await new Promise((resolve, reject) => {
        const req = db.transaction("memories").objectStore("memories").getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (error) {
      console.error("Could not read memories:", error);
    }
    return [...legacy, ...modern].sort((a, b) =>
      String(a.createdAt).localeCompare(String(b.createdAt))
    );
  }

  // Save a memory. Tries to keep the video for shake-to-replay; if the
  // video is too big or storage is full, saves the still keepsake only.
  async function save(memory, videoBlob) {
    const db = await open();

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    let videoSaved = false;
    let reason = "";

    if (videoBlob && videoBlob.size <= Flurry.MAX_VIDEO_BYTES) {
      try {
        const tx = db.transaction(["memories", "videos"], "readwrite");
        tx.objectStore("videos").put(videoBlob, memory.id);
        tx.objectStore("memories").put({ ...memory, hasVideo: true, videoType: videoBlob.type });
        await done(tx);
        videoSaved = true;
      } catch (error) {
        console.warn("Video not stored, saving still globe only:", error);
        reason = "storage";
      }
    } else if (videoBlob) {
      reason = "size";
    }

    if (!videoSaved) {
      const tx = db.transaction("memories", "readwrite");
      tx.objectStore("memories").put({ ...memory, hasVideo: false });
      await done(tx);
    }

    return { videoSaved, reason };
  }

  async function getVideo(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction("videos").objectStore("videos").get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  // Reset Shelf: remove every memory, video, and the older localStorage list
  async function clearAll() {
    localStorage.removeItem(LEGACY_KEY);
    const db = await open();
    const tx = db.transaction(["memories", "videos"], "readwrite");
    tx.objectStore("memories").clear();
    tx.objectStore("videos").clear();
    await done(tx);
  }

  return { list, save, getVideo, clearAll };
})();
