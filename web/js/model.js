// Pure document logic: shape geometry, crop/resize transforms, hit testing and
// undo history. No DOM or canvas access, so it runs under node:test.
//
// Shapes are plain JSON objects in image pixel coordinates:
//   line / arrow / rect / censor: { type, x1, y1, x2, y2, color, width, mode? }
//   pen:  { type, points: [[x, y], ...], color, width }
//   text: { type, x, y, text, size, color }   (x, y = top-left of first line)

export const TEXT_LINE_HEIGHT = 1.2;

/** Normalise two corner points into { x, y, w, h } with non-negative size. */
export function normRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

/** Clamp a rect to the image bounds, rounding to whole pixels. */
export function clampRect(r, imgW, imgH) {
  const x = Math.max(0, Math.round(r.x));
  const y = Math.max(0, Math.round(r.y));
  const x2 = Math.min(imgW, Math.round(r.x + r.w));
  const y2 = Math.min(imgH, Math.round(r.y + r.h));
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

/** Approximate text block size without a canvas (monospace-ish estimate). */
export function textSize(s) {
  const lines = String(s.text).split('\n');
  const longest = Math.max(...lines.map((l) => l.length), 1);
  return { w: longest * s.size * 0.6, h: lines.length * s.size * TEXT_LINE_HEIGHT };
}

/** Bounding box of a shape as { x, y, w, h }. */
export function shapeBounds(s) {
  switch (s.type) {
    case 'pen': {
      const xs = s.points.map((p) => p[0]);
      const ys = s.points.map((p) => p[1]);
      return normRect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    }
    case 'text': {
      const { w, h } = s.measured ?? textSize(s);
      return { x: s.x, y: s.y, w, h };
    }
    default:
      return normRect(s.x1, s.y1, s.x2, s.y2);
  }
}

export function cloneShape(s) {
  return structuredClone(s);
}

/** Returns a copy of s moved by (dx, dy). */
export function translateShape(s, dx, dy) {
  const out = cloneShape(s);
  if (s.type === 'pen') {
    out.points = s.points.map(([x, y]) => [x + dx, y + dy]);
  } else if (s.type === 'text') {
    out.x += dx;
    out.y += dy;
  } else {
    out.x1 += dx; out.x2 += dx;
    out.y1 += dy; out.y2 += dy;
  }
  return out;
}

/**
 * Returns a copy of s scaled by (sx, sy) about the origin. Stroke widths and
 * text sizes scale by the geometric mean so annotations keep their weight
 * relative to the image.
 */
export function scaleShape(s, sx, sy) {
  const k = Math.sqrt(sx * sy);
  const out = cloneShape(s);
  if (s.type === 'pen') {
    out.points = s.points.map(([x, y]) => [x * sx, y * sy]);
  } else if (s.type === 'text') {
    out.x *= sx;
    out.y *= sy;
    out.size = s.size * k;
    delete out.measured;
  } else {
    out.x1 *= sx; out.x2 *= sx;
    out.y1 *= sy; out.y2 *= sy;
  }
  if (out.width !== undefined) out.width = s.width * k;
  return out;
}

/** Shapes after cropping the image to rect (shapes keep their image position). */
export function cropShapes(shapes, rect) {
  return shapes.map((s) => translateShape(s, -rect.x, -rect.y));
}

/** Shapes after resizing the image from (w, h) to (nw, nh). */
export function resizeShapes(shapes, w, h, nw, nh) {
  return shapes.map((s) => scaleShape(s, nw / w, nh / h));
}

/** Width/height for a resize, preserving aspect ratio when one side is given. */
export function resizeDims(w, h, { width, height, keepAspect }) {
  let nw = width, nh = height;
  if (keepAspect) {
    if (width && !height) nh = (h * width) / w;
    else if (height && !width) nw = (w * height) / h;
    else if (width && height) nh = (h * width) / w;
  }
  nw = Math.round(nw || w);
  nh = Math.round(nh || h);
  if (nw < 1 || nh < 1) throw new Error('size must be at least 1×1');
  return { w: nw, h: nh };
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Is (x, y) on shape s, within tol image pixels? */
export function hitShape(s, x, y, tol) {
  const reach = tol + (s.width ?? 0) / 2;
  switch (s.type) {
    case 'line':
    case 'arrow':
      return distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) <= reach;
    case 'pen':
      if (s.points.length === 1) return Math.hypot(x - s.points[0][0], y - s.points[0][1]) <= reach;
      for (let i = 1; i < s.points.length; i++) {
        const [ax, ay] = s.points[i - 1], [bx, by] = s.points[i];
        if (distToSegment(x, y, ax, ay, bx, by) <= reach) return true;
      }
      return false;
    case 'rect': {
      // Outline only, so a box drawn around something doesn't swallow clicks
      // on shapes inside it.
      const r = normRect(s.x1, s.y1, s.x2, s.y2);
      const inOuter = x >= r.x - reach && x <= r.x + r.w + reach && y >= r.y - reach && y <= r.y + r.h + reach;
      const inInner = x > r.x + reach && x < r.x + r.w - reach && y > r.y + reach && y < r.y + r.h - reach;
      return inOuter && !inInner;
    }
    default: {
      const r = shapeBounds(s);
      return x >= r.x - tol && x <= r.x + r.w + tol && y >= r.y - tol && y <= r.y + r.h + tol;
    }
  }
}

/** Index of the topmost shape under (x, y), or -1. */
export function hitTest(shapes, x, y, tol = 6) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (hitShape(shapes[i], x, y, tol)) return i;
  }
  return -1;
}

/** Scale that fits (w, h) inside (vw, vh), never enlarging past 1:1. */
export function fitScale(w, h, vw, vh) {
  if (!w || !h) return 1;
  return Math.min(1, vw / w, vh / h);
}

/** Arrowhead polygon points for an arrow shape. */
export function arrowHead(s) {
  const len = Math.max(10, s.width * 4);
  const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
  const spread = Math.PI / 7;
  return [
    [s.x2, s.y2],
    [s.x2 - len * Math.cos(ang - spread), s.y2 - len * Math.sin(ang - spread)],
    [s.x2 - len * Math.cos(ang + spread), s.y2 - len * Math.sin(ang + spread)],
  ];
}

/** Drop degenerate shapes (a click without a drag). */
export function isMeaningful(s) {
  if (s.type === 'pen') return s.points.length > 0;
  if (s.type === 'text') return String(s.text).trim() !== '';
  const r = normRect(s.x1, s.y1, s.x2, s.y2);
  if (s.type === 'line' || s.type === 'arrow') return Math.hypot(r.w, r.h) >= 3;
  return r.w >= 3 && r.h >= 3;
}

/**
 * Snapshot undo history. A state is { base, shapes } where base is an
 * immutable raster (never drawn on after creation, so sharing it between
 * states is safe) and shapes is deep-copied.
 */
export class History {
  constructor(limit = 100) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Record `state` as the state before a change. */
  push(state) {
    this.undoStack.push(snapshot(state));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(snapshot(current));
    return this.undoStack.pop();
  }

  redo(current) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(snapshot(current));
    return this.redoStack.pop();
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}

function snapshot({ base, shapes }) {
  return { base, shapes: shapes.map(cloneShape) };
}
