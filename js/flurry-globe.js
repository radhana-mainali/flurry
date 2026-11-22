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

  // The glass dome (circle) in globe fractions, used to keep snow and
  // stickers-in-the-glass where they belong.
  dome: { cx: 0.5, cy: 0.385, r: 0.405 }
};

Flurry.STICKERS = [
  { id: "snowman",   src: "./images/stickers/snowman.png",   label: "Snowman",   width: 0.30 },
  { id: "hat",       src: "./images/stickers/hat.png",       label: "Winter hat", width: 0.26 },
  { id: "snowflake", src: "./images/stickers/snowflake.png", label: "Snowflake", width: 0.20 },
  { id: "orpheus",   src: "./images/stickers/orpheus.png",   label: "Orpheus",   width: 0.22 }
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

// Placeholder until Phase 2 adds the date stamp
Flurry.drawDateStamp = async function () {};

Flurry.canvasToBlob = function (canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      blob ? resolve(blob) : reject(new Error("Could not create image"));
    }, type, quality);
  });
};
