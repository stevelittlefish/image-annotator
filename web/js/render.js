// Canvas 2D rendering of the document: base raster plus annotation shapes.
import { normRect, arrowHead, shapeBounds, fitText, TEXT_LINE_HEIGHT } from './model.js';

export const FONT_FAMILY = 'system-ui, sans-serif';
const PIXEL_BLOCK = 12;

export function font(size) {
  return `600 ${size}px ${FONT_FAMILY}`;
}

/** Measure a text shape with real font metrics. */
export function measureText(ctx, s) {
  ctx.save();
  ctx.font = font(s.size);
  const lines = String(s.text).split('\n');
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
  ctx.restore();
  return { w, h: lines.length * s.size * TEXT_LINE_HEIGHT };
}

export function drawShape(ctx, s, base) {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (s.type) {
    case 'line':
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      break;
    case 'arrow': {
      const head = arrowHead(s);
      // Stop the shaft short of the tip so a wide line doesn't poke through it.
      const [tx, ty] = head[0];
      const mx = (head[1][0] + head[2][0]) / 2, my = (head[1][1] + head[2][1]) / 2;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo((tx + mx) / 2, (ty + my) / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(...head[0]);
      ctx.lineTo(...head[1]);
      ctx.lineTo(...head[2]);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'rect': {
      const r = normRect(s.x1, s.y1, s.x2, s.y2);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      break;
    }
    case 'censor':
      drawCensor(ctx, s, base);
      break;
    case 'pen':
      ctx.beginPath();
      ctx.moveTo(...s.points[0]);
      if (s.points.length === 1) ctx.lineTo(s.points[0][0] + 0.01, s.points[0][1]);
      for (const p of s.points.slice(1)) ctx.lineTo(...p);
      ctx.stroke();
      break;
    case 'text': {
      ctx.font = font(s.size);
      ctx.textBaseline = 'top';
      // Dark/light halo keeps text legible over busy screenshots.
      ctx.lineWidth = Math.max(2, s.size / 8);
      ctx.strokeStyle = isLight(s.color) ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)';
      String(s.text).split('\n').forEach((line, i) => {
        const y = s.y + i * s.size * TEXT_LINE_HEIGHT;
        ctx.strokeText(line, s.x, y);
        ctx.fillText(line, s.x, y);
      });
      break;
    }
  }
  ctx.restore();
}

function drawCensor(ctx, s, base) {
  const r = normRect(s.x1, s.y1, s.x2, s.y2);
  const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
  const w = Math.min(base?.width ?? 0, Math.round(r.x + r.w)) - x;
  const h = Math.min(base?.height ?? 0, Math.round(r.y + r.h)) - y;
  if (s.mode === 'pixelate' && w >= 1 && h >= 1) {
    // True block averages (drawImage downscaling point-samples, which leaves
    // sparse, partly legible pixels). Blocks grow with the box so small text
    // never survives as recognisable shapes.
    const block = Math.max(PIXEL_BLOCK, Math.ceil(Math.min(w, h) / 3));
    const src = base.getContext('2d').getImageData(x, y, w, h).data;
    const img = new ImageData(w, h);
    const out = img.data;
    for (let by = 0; by < h; by += block) {
      for (let bx = 0; bx < w; bx += block) {
        const bw = Math.min(block, w - bx), bh = Math.min(block, h - by);
        let rr = 0, gg = 0, bb = 0, aa = 0;
        for (let j = 0; j < bh; j++) {
          let i = ((by + j) * w + bx) * 4;
          for (let k = 0; k < bw; k++, i += 4) {
            const a = src[i + 3];
            rr += src[i] * a; gg += src[i + 1] * a; bb += src[i + 2] * a; aa += a;
          }
        }
        const px = aa ? [rr / aa, gg / aa, bb / aa, aa / (bw * bh)] : [0, 0, 0, 0];
        for (let j = 0; j < bh; j++) {
          let i = ((by + j) * w + bx) * 4;
          for (let k = 0; k < bw; k++, i += 4) out.set(px, i);
        }
      }
    }
    // putImageData replaces pixels outright (no compositing), so nothing
    // underneath — base or earlier annotations — shows through.
    ctx.putImageData(img, x, y);
  } else if (s.mode === 'label') {
    drawLabel(ctx, r, s.text ?? '');
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
}

export const LABEL_BG = '#ff00ff';
export const LABEL_FG = '#00ffff';
const LABEL_FONT = (size) => `800 ${size}px ${FONT_FAMILY}`;

/** Magenta box with cyan text auto-sized and wrapped to fill most of it. */
function drawLabel(ctx, r, text) {
  ctx.fillStyle = LABEL_BG;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  if (!text.trim() || r.w < 4 || r.h < 4) return;
  const measure = (str, size) => { ctx.font = LABEL_FONT(size); return ctx.measureText(str).width; };
  const { size, lines } = fitText(text, r.w, r.h, measure);
  ctx.font = LABEL_FONT(size);
  ctx.fillStyle = LABEL_FG;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lh = size * TEXT_LINE_HEIGHT;
  const top = r.y + r.h / 2 - (lines.length * lh) / 2 + lh / 2;
  lines.forEach((line, i) => ctx.fillText(line, r.x + r.w / 2, top + i * lh));
}

function isLight(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 160;
}

/** Draw the full document (base + shapes) at native resolution. */
export function renderDoc(ctx, base, shapes) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(base, 0, 0);
  for (const s of shapes) drawShape(ctx, s, base);
}

/** Selection outline; `scale` is screen px per image px so it stays crisp. */
export function drawSelection(ctx, s, scale) {
  const b = shapeBounds(s);
  const pad = 4 / scale;
  ctx.save();
  ctx.lineWidth = 1.5 / scale;
  ctx.setLineDash([5 / scale, 4 / scale]);
  ctx.strokeStyle = '#a97ae8';
  ctx.strokeRect(b.x - pad - (s.width ?? 0) / 2, b.y - pad - (s.width ?? 0) / 2,
    b.w + 2 * pad + (s.width ?? 0), b.h + 2 * pad + (s.width ?? 0));
  ctx.restore();
}

/** Dim everything outside the pending crop rect. */
export function drawCropOverlay(ctx, r, scale) {
  const { width: W, height: H } = ctx.canvas;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill('evenodd');
  ctx.lineWidth = 1.5 / scale;
  ctx.setLineDash([6 / scale, 4 / scale]);
  ctx.strokeStyle = '#fff';
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
}

/** Decode an image Blob into a canvas (the immutable base raster). */
export async function blobToCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  try {
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    return c;
  } finally {
    bmp.close();
  }
}
