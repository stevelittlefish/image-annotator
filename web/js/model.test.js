import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normRect, clampRect, shapeBounds, translateShape, scaleShape, cropShapes,
  resizeShapes, resizeDims, hitTest, fitScale, isMeaningful, History, wrapText, fitText,
} from './model.js';

test('normRect handles any drag direction', () => {
  assert.deepEqual(normRect(10, 20, 4, 5), { x: 4, y: 5, w: 6, h: 15 });
});

test('clampRect keeps crops inside the image', () => {
  assert.deepEqual(clampRect({ x: -5, y: 10, w: 200, h: 20 }, 100, 50), { x: 0, y: 10, w: 100, h: 20 });
  assert.deepEqual(clampRect({ x: 120, y: 0, w: 10, h: 10 }, 100, 50).w, 0);
});

test('translate and crop move every shape kind', () => {
  const shapes = [
    { type: 'rect', x1: 10, y1: 10, x2: 20, y2: 20, width: 2 },
    { type: 'pen', points: [[10, 10], [15, 12]], width: 2 },
    { type: 'text', x: 30, y: 40, text: 'hi', size: 20 },
  ];
  const out = cropShapes(shapes, { x: 5, y: 10, w: 50, h: 50 });
  assert.deepEqual([out[0].x1, out[0].y1], [5, 0]);
  assert.deepEqual(out[1].points[1], [10, 2]);
  assert.deepEqual([out[2].x, out[2].y], [25, 30]);
  assert.equal(shapes[0].x1, 10, 'original untouched');
});

test('scale adjusts geometry, stroke width and text size', () => {
  const s = scaleShape({ type: 'line', x1: 10, y1: 10, x2: 20, y2: 30, width: 4 }, 0.5, 0.5);
  assert.deepEqual([s.x1, s.y2, s.width], [5, 15, 2]);
  const t = resizeShapes([{ type: 'text', x: 10, y: 10, text: 'a', size: 20, measured: { w: 1, h: 1 } }], 100, 100, 200, 200)[0];
  assert.equal(t.size, 40);
  assert.equal(t.measured, undefined, 'stale measurement dropped');
});

test('resizeDims preserves aspect when asked', () => {
  assert.deepEqual(resizeDims(400, 200, { width: 200, keepAspect: true }), { w: 200, h: 100 });
  assert.deepEqual(resizeDims(400, 200, { height: 50, keepAspect: true }), { w: 100, h: 50 });
  assert.deepEqual(resizeDims(400, 200, { width: 10, height: 10, keepAspect: false }), { w: 10, h: 10 });
  assert.throws(() => resizeDims(400, 200, { width: 0.2, height: 0.2 }));
});

test('hitTest finds the topmost shape and ignores rect interiors', () => {
  const shapes = [
    { type: 'censor', x1: 0, y1: 0, x2: 100, y2: 100 },
    { type: 'rect', x1: 10, y1: 10, x2: 90, y2: 90, width: 2 },
    { type: 'line', x1: 0, y1: 50, x2: 100, y2: 50, width: 2 },
  ];
  assert.equal(hitTest(shapes, 50, 51), 2);
  assert.equal(hitTest(shapes, 10, 30), 1);
  assert.equal(hitTest(shapes, 30, 30), 0, 'inside rect falls through to censor');
  assert.equal(hitTest(shapes, 500, 500), -1);
});

test('shapeBounds of pen and text', () => {
  assert.deepEqual(shapeBounds({ type: 'pen', points: [[5, 9], [1, 3]] }), { x: 1, y: 3, w: 4, h: 6 });
  assert.deepEqual(shapeBounds({ type: 'text', x: 1, y: 2, text: 'x', size: 10, measured: { w: 7, h: 12 } }),
    { x: 1, y: 2, w: 7, h: 12 });
});

test('fitScale never enlarges', () => {
  assert.equal(fitScale(100, 100, 1000, 1000), 1);
  assert.equal(fitScale(2000, 1000, 1000, 1000), 0.5);
});

test('isMeaningful drops click-without-drag shapes', () => {
  assert.equal(isMeaningful({ type: 'rect', x1: 1, y1: 1, x2: 2, y2: 2 }), false);
  assert.equal(isMeaningful({ type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 0 }), true);
  assert.equal(isMeaningful({ type: 'text', text: '  ' }), false);
});

test('History undo/redo round-trips and isolates shape copies', () => {
  const h = new History();
  const base = {};
  const a = { base, shapes: [] };
  const b = { base, shapes: [{ type: 'rect', x1: 0, y1: 0, x2: 5, y2: 5 }] };
  h.push(a);
  b.shapes[0].x1 = 1; // mutate after push must not affect history
  const undone = h.undo(b);
  assert.deepEqual(undone.shapes, []);
  assert.equal(undone.base, base);
  const redone = h.redo(undone);
  assert.equal(redone.shapes[0].x1, 1);
  assert.equal(h.canRedo, false);
  h.push(redone);
  assert.equal(h.canRedo, false, 'new change clears redo');
});

// Fake metrics: every character is 0.5em wide.
const measure = (s, size) => s.length * size * 0.5;

test('wrapText breaks on words and keeps explicit newlines', () => {
  assert.deepEqual(wrapText('This model is too horny!', 10, 70, measure), ['This model is', 'too horny!']);
  assert.deepEqual(wrapText('a\nb', 10, 1000, measure), ['a', 'b']);
});

test('fitText picks the largest size that fills the box', () => {
  const { size, lines } = fitText('This model is too horny!', 330, 115, measure);
  // Must fit within 85% of the box...
  assert.ok(lines.length * size * 1.2 <= 115 * 0.85);
  assert.ok(lines.every((l) => measure(l, size) <= 330 * 0.85));
  // ...and one size larger must not.
  const bigger = wrapText('This model is too horny!', size + 1, 330 * 0.85, measure);
  assert.ok(bigger.length * (size + 1) * 1.2 > 115 * 0.85 || bigger.some((l) => measure(l, size + 1) > 330 * 0.85));
  assert.ok(lines.length >= 2, 'wide-ish box wraps onto two lines like the reference');
});

test('fitText survives tiny boxes and empty text', () => {
  assert.equal(fitText('hello', 2, 2, measure).size, 1);
  assert.deepEqual(fitText('', 100, 100, measure).lines, ['']);
});
