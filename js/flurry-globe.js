// Shared snow globe geometry + high-resolution compositor.
// Used by index.html (making a globe) and shelf.html (viewing one).
//
// All positions are fractions of the globe box, which is exactly the
// trimmed artwork (images/trimmed/snowglobe.png, 956 x 1107).
// The three photo boxes are the same numbers the team tuned in style.css
// (.hole1 / .hole2 / .hole3), so the canvas output lines up with the page.

window.Flurry = window.Flurry || {};

Flurry.GLOBE = {
  art: "./images/trimmed/snowglobe.png",
  width: 956,
  height: 1107,

  holes: [
    { left: 0.11,  top: 0.13,   width: 0.40,   height: 0.35,   rotate: -17 },
    { left: 0.512, top: 0.281,  width: 0.365,  height: 0.315,  rotate: 15 },
    { left: 0.259, top: 0.5036, width: 0.2156, height: 0.1863, rotate: -7 }
  ],

  // The glass dome, measured from the artwork: a circle centred at
  // (cx, cy) (fractions of width / height) with radius r (fraction of
  // width). floor = top of the drawn snow mound (fraction of height).
  dome: { cx: 0.466, cy: 0.398, r: 0.445, floor: 0.665 }
};

// Each sticker has a default spot around the edge of the glass, so a new
// sticker doesn't cover the photos (x / y = centre, fractions of the globe).
Flurry.STICKERS = [
  { id: "snowman",   src: "./images/stickers/snowman.png",   label: "Snowman",    width: 0.28, spot: { x: 0.74, y: 0.585 } },
  { id: "hat",       src: "./images/stickers/hat.png",       label: "Winter hat", width: 0.26, spot: { x: 0.52, y: 0.115 } },
  { id: "snowflake", src: "./images/stickers/snowflake.png", label: "Snowflake",  width: 0.17, spot: { x: 0.84, y: 0.2 } },
  { id: "orpheus",   src: "./images/stickers/orpheus.png",   label: "Orpheus",    width: 0.19, spot: { x: 0.17, y: 0.565 } }
];

Flurry.TAPE = "./images/stickers/tape.png";

Flurry.loadImage = function (src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load " + src));
    img.src = src;
  });
};

// Draw an image like CSS object-fit: cover into a box centred on (0, 0)
function drawCover(ctx, img, boxW, boxH) {
  const iw = img.naturalWidth || img.videoWidth || img.width;
  const ih = img.naturalHeight || img.videoHeight || img.height;
  const scale = Math.max(boxW / iw, boxH / ih);
  const w = iw * scale;
  const h = ih * scale;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
}

// Build the finished globe as a canvas.
// photos: three loaded <img> elements (already rotated the right way up)
// stickers: [{ id, x, y, width, rotate }] in globe fractions (x/y = centre)
// date: { on, text } or null
Flurry.composeGlobe = async function ({ photos, stickers = [], date = null }, scale = 1) {
  const G = Flurry.GLOBE;
  const W = Math.round(G.width * scale);
  const H = Math.round(G.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";

  // 1. Photos behind the artwork, in the tilted openings
  G.holes.forEach((hole, i) => {
    const img = photos[i];
    if (!img) return;
    const bw = hole.width * W;
    const bh = hole.height * H;
    ctx.save();
    ctx.translate(hole.left * W + bw / 2, hole.top * H + bh / 2);
    ctx.rotate(hole.rotate * Math.PI / 180);
    ctx.beginPath();
    ctx.rect(-bw / 2, -bh / 2, bw, bh);
    ctx.clip();
    drawCover(ctx, img, bw, bh);
    ctx.restore();
  });

  // 2. The team's globe drawing on top
  const art = await Flurry.loadImage(G.art);
  ctx.drawImage(art, 0, 0, W, H);

  // 3. Date stamp (tape + typewriter text)
  if (date && date.on && date.text) {
    await Flurry.drawDateStamp(ctx, date, W, H);
  }

  // 4. Stickers on top of everything
  for (const s of stickers) {
    const def = Flurry.STICKERS.find(d => d.id === s.id);
    if (!def) continue;
    const img = await Flurry.loadImage(def.src);
    const w = s.width * W;
    const h = w * img.naturalHeight / img.naturalWidth;
    ctx.save();
    ctx.translate(s.x * W, s.y * H);
    ctx.rotate((s.rotate || 0) * Math.PI / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  return canvas;
};

// Where the date stamp sits: a strip of the team's pink tape across the
// lower-right corner of the big top-left photo.
Flurry.DATE_STAMP = { x: 0.405, y: 0.47, width: 0.27, rotate: -13 };
Flurry.DATE_FONT = "TypewriterInked";

// "NOV 21, 2026"
Flurry.formatStampDate = function (date) {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return months[date.getMonth()] + " " + date.getDate() + ", " + date.getFullYear();
};

Flurry.drawDateStamp = async function (ctx, date, W, H) {
  const D = Flurry.DATE_STAMP;
  const tape = await Flurry.loadImage(Flurry.TAPE);
  try {
    await document.fonts.load(`${Math.round(W * 0.034)}px ${Flurry.DATE_FONT}`);
  } catch (e) {}

  const w = D.width * W;
  const h = w * tape.naturalHeight / tape.naturalWidth;
  ctx.save();
  ctx.translate(D.x * W, D.y * H);
  ctx.rotate(D.rotate * Math.PI / 180);
  ctx.globalAlpha = 0.92;
  ctx.drawImage(tape, -w / 2, -h / 2, w, h);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#8a4a6b";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(W * 0.034)}px ${Flurry.DATE_FONT}, "Courier New", monospace`;
  ctx.fillText(date.text, 0, h * 0.04, w * 0.86);
  ctx.restore();
};

// ---------- the same decorations as page elements ----------

Flurry.stickerElement = function (s) {
  const def = Flurry.STICKERS.find(d => d.id === s.id);
  const img = document.createElement("img");
  img.src = def ? def.src : "";
  img.alt = def ? def.label + " sticker" : "Sticker";
  img.className = "globe-sticker";
  img.draggable = false;
  Flurry.placeSticker(img, s);
  return img;
};

Flurry.placeSticker = function (el, s) {
  el.style.left = (s.x * 100) + "%";
  el.style.top = (s.y * 100) + "%";
  el.style.width = (s.width * 100) + "%";
  el.style.transform = `translate(-50%, -50%) rotate(${s.rotate || 0}deg)`;
};

Flurry.dateStampElement = function (date) {
  const D = Flurry.DATE_STAMP;
  const el = document.createElement("div");
  el.className = "date-stamp";
  el.style.left = (D.x * 100) + "%";
  el.style.top = (D.y * 100) + "%";
  el.style.width = (D.width * 100) + "%";
  el.style.transform = `translate(-50%, -50%) rotate(${D.rotate}deg)`;
  const span = document.createElement("span");
  span.textContent = date.text;
  el.appendChild(span);
  return el;
};

// Recording date from an MP4 / MOV file's "mvhd" header, if it has a
// believable one. Returns a Date or null. (Edited or re-exported videos
// may carry the export date instead, so the user can always change it.)
Flurry.readRecordingDate = async function (file) {
  try {
    const read = async (start, length) =>
      new DataView(await file.slice(start, start + length).arrayBuffer());

    // Find the top-level "moov" box
    let pos = 0;
    let moov = null;
    while (pos + 8 <= file.size) {
      const head = await read(pos, 16);
      let size = head.getUint32(0);
      const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
      if (size === 1) size = Number(head.getBigUint64(8));
      if (size === 0) size = file.size - pos;
      if (size < 8) break;
      if (type === "moov") { moov = { start: pos, size }; break; }
      pos += size;
    }
    if (!moov || moov.size > 64 * 1024 * 1024) return null;

    const bytes = new Uint8Array(await file.slice(moov.start, moov.start + moov.size).arrayBuffer());
    for (let i = 8; i < bytes.length - 24; i++) {
      // "mvhd"
      if (bytes[i] === 0x6d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64) {
        const view = new DataView(bytes.buffer, i + 4);
        const version = view.getUint8(0);
        const seconds = version === 1 ? Number(view.getBigUint64(4)) : view.getUint32(4);
        // seconds since 1 Jan 1904 (UTC)
        const date = new Date(Date.UTC(1904, 0, 1) + seconds * 1000);
        const year = date.getFullYear();
        if (seconds > 0 && year >= 2000 && date.getTime() <= Date.now() + 86400000) {
          return date;
        }
        return null;
      }
    }
  } catch (error) {
    console.warn("Could not read recording date:", error);
  }
  return null;
};

Flurry.canvasToBlob = function (canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      blob ? resolve(blob) : reject(new Error("Could not create image"));
    }, type, quality);
  });
};
