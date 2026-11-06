// UI wiring: tools, pointer handling, load/paste/drop, crop/resize, export.
import {
  History, hitTest, translateShape, cropShapes, resizeShapes, resizeDims,
  clampRect, normRect, fitScale, isMeaningful, cloneShape,
} from './model.js';
import {
  renderDoc, drawSelection, drawCropOverlay, measureText, canvasToBlob, blobToCanvas,
} from './render.js';
import { saveSession, loadSession, loadSettings, saveSettings } from './storage.js';

const $ = (id) => document.getElementById(id);
const view = $('view');
const ctx = view.getContext('2d');
const stage = $('stage');
const textEditor = $('text-editor');

const SWATCHES = ['#e0303a', '#e933c8', '#ffe14d', '#3cc25a', '#2f8cff', '#a97ae8', '#ffffff', '#111111'];
const TOOL_KEYS = { v: 'select', c: 'crop', l: 'line', a: 'arrow', r: 'rect', p: 'pen', t: 'text', x: 'censor' };

const settings = loadSettings({ tool: 'arrow', color: '#e0303a', width: 4, textSize: 28, censorMode: 'solid', censorText: 'Censored' });

const state = {
  base: null,        // immutable HTMLCanvasElement — replaced, never drawn on
  shapes: [],
  name: 'image',
  selected: -1,
  drag: null,
  crop: null,        // pending crop rect in image px
  editing: null,     // { index (or -1 for new), shape } while the text box is open
  scale: 1,
};
const history = new History();

// ---- state changes ---------------------------------------------------------

function snapshot() {
  return { base: state.base, shapes: state.shapes };
}

/** Record the current state for undo, then apply `fn`. */
function commit(fn) {
  history.push(snapshot());
  fn();
  changed();
}

function changed() {
  if (state.selected >= state.shapes.length) state.selected = -1;
  layout();
  render();
  updateButtons();
  scheduleSave();
}

function restore(s) {
  if (!s) return;
  state.base = s.base;
  state.shapes = s.shapes;
  state.selected = -1;
  cancelCrop();
  changed();
}

function setImage(canvas, name) {
  closeTextEditor(false);
  cancelCrop();
  if (state.base) history.push(snapshot());
  state.base = canvas;
  state.shapes = [];
  state.selected = -1;
  if (name) state.name = name.replace(/\.[^.]+$/, '') || 'image';
  $('empty').hidden = true;
  $('canvas-wrap').hidden = false;
  changed();
  status(`${canvas.width}×${canvas.height}`);
}

async function loadBlob(blob, name) {
  try {
    setImage(await blobToCanvas(blob), name);
  } catch (err) {
    status(`Couldn't read that image: ${err.message}`, 'bad');
  }
}

// ---- rendering -------------------------------------------------------------

function layout() {
  if (!state.base) return;
  const { width: w, height: h } = state.base;
  if (view.width !== w || view.height !== h) {
    view.width = w;
    view.height = h;
  }
  state.scale = fitScale(w, h, stage.clientWidth - 32, stage.clientHeight - 32);
  view.style.width = `${w * state.scale}px`;
  view.style.height = `${h * state.scale}px`;
}

function render() {
  if (!state.base) return;
  let shapes = state.shapes;
  if (state.editing && state.editing.index >= 0) shapes = shapes.filter((_, i) => i !== state.editing.index);
  if (state.drag?.kind === 'draw') shapes = [...shapes, state.drag.shape];
  renderDoc(ctx, state.base, shapes);
  if (state.selected >= 0 && !state.editing) drawSelection(ctx, state.shapes[state.selected], state.scale);
  if (state.crop) drawCropOverlay(ctx, state.crop, state.scale);
}

function updateButtons() {
  const has = !!state.base;
  $('undo').disabled = !history.canUndo;
  $('redo').disabled = !history.canRedo;
  for (const id of ['resize', 'copy', 'save']) $(id).disabled = !has;
  $('delete').disabled = state.selected < 0;
}

let statusTimer;
function status(msg, kind = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = kind;
  clearTimeout(statusTimer);
  if (kind) statusTimer = setTimeout(() => { el.textContent = ''; el.className = ''; }, 4000);
}

// ---- tools -----------------------------------------------------------------

function setTool(tool) {
  if (tool !== 'crop') cancelCrop();
  closeTextEditor(true);
  settings.tool = tool;
  saveSettings(settings);
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === tool);
  view.className = `tool-${tool}`;
  if (tool !== 'select') state.selected = -1;
  render();
  updateButtons();
}

function toImage(e) {
  const r = view.getBoundingClientRect();
  return [(e.clientX - r.left) * (view.width / r.width), (e.clientY - r.top) * (view.height / r.height)];
}

/** Snap an endpoint to 45° increments (Shift while drawing lines/arrows). */
function snap45(x1, y1, x2, y2) {
  const ang = Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(x2 - x1, y2 - y1);
  return [x1 + len * Math.cos(ang), y1 + len * Math.sin(ang)];
}

function style() {
  return { color: settings.color, width: Number(settings.width) };
}

view.addEventListener('pointerdown', (e) => {
  if (!state.base || e.button !== 0) return;
  const [x, y] = toImage(e);
  const tool = settings.tool;
  const tol = 6 / state.scale;

  if (state.editing) { closeTextEditor(true); if (tool === 'text') return; }

  if (tool === 'select') {
    state.selected = hitTest(state.shapes, x, y, tol);
    const sel = state.shapes[state.selected];
    if (sel?.type === 'censor') {
      $('censor-mode').value = sel.mode ?? 'solid';
      $('censor-text').value = sel.text ?? '';
      $('censor-text-label').hidden = sel.mode !== 'label';
    }
    if (state.selected >= 0) {
      state.drag = { kind: 'move', start: [x, y], orig: cloneShape(state.shapes[state.selected]), pushed: false };
    }
  } else if (tool === 'crop') {
    state.drag = { kind: 'crop', start: [x, y] };
    state.crop = { x, y, w: 0, h: 0 };
    $('crop-bar').hidden = false;
  } else if (tool === 'text') {
    const idx = hitTest(state.shapes, x, y, tol);
    if (idx >= 0 && state.shapes[idx].type === 'text') openTextEditor(idx, state.shapes[idx]);
    else openTextEditor(-1, { type: 'text', x, y, text: '', size: Number(settings.textSize), color: settings.color });
    e.preventDefault(); // keep focus in the text box
    return;
  } else if (tool === 'pen') {
    state.drag = { kind: 'draw', shape: { type: 'pen', points: [[x, y]], ...style() } };
  } else {
    const shape = { type: tool, x1: x, y1: y, x2: x, y2: y, ...style() };
    if (tool === 'censor') Object.assign(shape, { mode: settings.censorMode, text: settings.censorText });
    state.drag = { kind: 'draw', shape };
  }
  if (state.drag) view.setPointerCapture(e.pointerId);
  render();
  updateButtons();
});

view.addEventListener('pointermove', (e) => {
  const d = state.drag;
  if (!d) return;
  let [x, y] = toImage(e);
  if (d.kind === 'move') {
    if (!d.pushed) { history.push(snapshot()); d.pushed = true; }
    const shapes = state.shapes.slice();
    shapes[state.selected] = translateShape(d.orig, x - d.start[0], y - d.start[1]);
    state.shapes = shapes;
  } else if (d.kind === 'crop') {
    x = Math.max(0, Math.min(view.width, x));
    y = Math.max(0, Math.min(view.height, y));
    state.crop = normRect(d.start[0], d.start[1], x, y);
    const c = clampRect(state.crop, view.width, view.height);
    $('crop-size').textContent = `${c.w}×${c.h}`;
  } else if (d.shape.type === 'pen') {
    const last = d.shape.points.at(-1);
    if (Math.hypot(x - last[0], y - last[1]) >= 1 / state.scale) d.shape.points.push([x, y]);
  } else {
    if (e.shiftKey && (d.shape.type === 'line' || d.shape.type === 'arrow')) [x, y] = snap45(d.shape.x1, d.shape.y1, x, y);
    d.shape.x2 = x;
    d.shape.y2 = y;
  }
  render();
});

function endDrag() {
  const d = state.drag;
  if (!d) return;
  state.drag = null;
  if (d.kind === 'draw') {
    if (isMeaningful(d.shape)) commit(() => { state.shapes = [...state.shapes, d.shape]; });
    else render();
  } else if (d.kind === 'move') {
    if (d.pushed) changed();
  } else if (d.kind === 'crop') {
    if (state.crop.w < 2 || state.crop.h < 2) cancelCrop();
    render();
  }
}
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);

view.addEventListener('dblclick', (e) => {
  if (settings.tool !== 'select') return;
  const [x, y] = toImage(e);
  const idx = hitTest(state.shapes, x, y, 6 / state.scale);
  if (idx >= 0 && state.shapes[idx].type === 'text') openTextEditor(idx, state.shapes[idx]);
});

function deleteSelected() {
  if (state.selected < 0) return;
  const i = state.selected;
  commit(() => {
    state.shapes = state.shapes.filter((_, j) => j !== i);
    state.selected = -1;
  });
}

/** Apply a style change to the selected shape, if one fits. */
function restyleSelected(patch) {
  const s = state.shapes[state.selected];
  if (!s) return;
  const p = Object.fromEntries(Object.entries(patch).filter(([k]) => k in s));
  if (!Object.keys(p).length) return;
  commit(() => {
    const shapes = state.shapes.slice();
    const next = { ...s, ...p };
    if (next.type === 'text') next.measured = measureText(ctx, next);
    shapes[state.selected] = next;
    state.shapes = shapes;
  });
}

function remeasure(i) {
  const s = state.shapes[i];
  s.measured = measureText(ctx, s);
}

// ---- text ------------------------------------------------------------------

function openTextEditor(index, shape) {
  state.editing = { index, shape: cloneShape(shape) };
  const s = state.editing.shape;
  textEditor.value = s.text;
  textEditor.style.left = `${s.x * state.scale}px`;
  textEditor.style.top = `${s.y * state.scale}px`;
  textEditor.style.fontSize = `${s.size * state.scale}px`;
  textEditor.style.color = s.color;
  textEditor.hidden = false;
  sizeTextEditor();
  render();
  requestAnimationFrame(() => { textEditor.focus(); textEditor.select(); });
}

function sizeTextEditor() {
  const lines = textEditor.value.split('\n');
  textEditor.rows = lines.length;
  textEditor.cols = Math.max(2, ...lines.map((l) => l.length + 1));
  textEditor.style.width = 'auto';
  textEditor.style.width = `${textEditor.scrollWidth + 4}px`;
  textEditor.style.height = 'auto';
  textEditor.style.height = `${textEditor.scrollHeight}px`;
}

function closeTextEditor(keep) {
  const ed = state.editing;
  if (!ed) return;
  state.editing = null;
  textEditor.hidden = true;
  const s = { ...ed.shape, text: textEditor.value.replace(/\s+$/, '') };
  s.measured = measureText(ctx, s);
  const changedText = ed.index < 0 || s.text !== ed.shape.text;
  if (keep && changedText) {
    commit(() => {
      const shapes = state.shapes.slice();
      if (ed.index >= 0) {
        if (isMeaningful(s)) shapes[ed.index] = s; else shapes.splice(ed.index, 1);
      } else if (isMeaningful(s)) {
        shapes.push(s);
      }
      state.shapes = shapes;
    });
  } else {
    render();
  }
}

textEditor.addEventListener('input', sizeTextEditor);
textEditor.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeTextEditor(true); }
  else if (e.key === 'Escape') { e.preventDefault(); closeTextEditor(false); }
  e.stopPropagation();
});
textEditor.addEventListener('blur', () => closeTextEditor(true));

// ---- crop & resize ---------------------------------------------------------

function cancelCrop() {
  state.crop = null;
  $('crop-bar').hidden = true;
}

function applyCrop() {
  if (!state.crop) return;
  const r = clampRect(state.crop, state.base.width, state.base.height);
  if (r.w < 1 || r.h < 1) { cancelCrop(); render(); return; }
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  c.getContext('2d').drawImage(state.base, -r.x, -r.y);
  commit(() => {
    state.base = c;
    state.shapes = cropShapes(state.shapes, r);
    state.selected = -1;
    cancelCrop();
  });
  status(`Cropped to ${r.w}×${r.h}`, 'ok');
}

function resizeTo(nw, nh) {
  const { width: w, height: h } = state.base;
  if (nw === w && nh === h) return;
  const c = document.createElement('canvas');
  c.width = nw;
  c.height = nh;
  const cctx = c.getContext('2d');
  cctx.imageSmoothingQuality = 'high';
  cctx.drawImage(state.base, 0, 0, nw, nh);
  commit(() => {
    state.base = c;
    state.shapes = resizeShapes(state.shapes, w, h, nw, nh);
    state.shapes.forEach((s, i) => { if (s.type === 'text') remeasure(i); });
  });
  status(`Resized to ${nw}×${nh}`, 'ok');
}

const rd = $('resize-dialog');
$('resize').addEventListener('click', () => {
  const { width: w, height: h } = state.base;
  $('resize-current').textContent = `Current: ${w}×${h}`;
  $('resize-w').value = w;
  $('resize-h').value = h;
  $('resize-pct').value = 100;
  rd.showModal();
});
$('resize-w').addEventListener('input', () => {
  if (!$('resize-aspect').checked) return;
  const { w, h } = resizeDims(state.base.width, state.base.height, { width: Number($('resize-w').value) || 1, keepAspect: true });
  $('resize-h').value = h;
  $('resize-pct').value = Math.round((w / state.base.width) * 100);
});
$('resize-h').addEventListener('input', () => {
  if (!$('resize-aspect').checked) return;
  const { w, h } = resizeDims(state.base.width, state.base.height, { height: Number($('resize-h').value) || 1, keepAspect: true });
  $('resize-w').value = w;
  $('resize-pct').value = Math.round((h / state.base.height) * 100);
});
$('resize-pct').addEventListener('input', () => {
  const k = (Number($('resize-pct').value) || 100) / 100;
  $('resize-w').value = Math.max(1, Math.round(state.base.width * k));
  $('resize-h').value = Math.max(1, Math.round(state.base.height * k));
});
rd.addEventListener('close', () => {
  if (rd.returnValue !== 'ok') return;
  try {
    const { w, h } = resizeDims(state.base.width, state.base.height, {
      width: Number($('resize-w').value), height: Number($('resize-h').value), keepAspect: false,
    });
    resizeTo(w, h);
  } catch (err) {
    status(err.message, 'bad');
  }
});

// ---- export ----------------------------------------------------------------

function flatten() {
  const c = document.createElement('canvas');
  c.width = state.base.width;
  c.height = state.base.height;
  renderDoc(c.getContext('2d'), state.base, state.shapes);
  return canvasToBlob(c);
}

async function savePNG() {
  if (!state.base) return;
  closeTextEditor(true);
  const url = URL.createObjectURL(await flatten());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.name}-annotated.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  status('Saved PNG', 'ok');
}

async function copyPNG() {
  if (!state.base) return;
  closeTextEditor(true);
  if (!window.isSecureContext || !navigator.clipboard?.write) {
    status('Clipboard needs https or localhost — use Save PNG', 'bad');
    return;
  }
  try {
    // Passing the promise (not the blob) keeps the user-gesture alive in Safari.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': flatten() })]);
    status('Copied to clipboard', 'ok');
  } catch (err) {
    status(`Copy failed: ${err.message}`, 'bad');
  }
}

$('save').addEventListener('click', savePNG);
$('copy').addEventListener('click', copyPNG);

// ---- input: open, paste, drop ----------------------------------------------

$('file-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) loadBlob(f, f.name);
  e.target.value = '';
});

document.addEventListener('paste', (e) => {
  if (document.activeElement === textEditor) return;
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  loadBlob(item.getAsFile(), 'pasted');
});

stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragover'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('dragover');
  const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
  if (f) loadBlob(f, f.name);
  else status('Drop an image file', 'bad');
});

// ---- keyboard --------------------------------------------------------------

function isTyping() {
  const el = document.activeElement;
  return el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'range' && el.type !== 'checkbox') || el.tagName === 'SELECT');
}

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || isTyping()) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); restore(e.shiftKey ? history.redo(snapshot()) : history.undo(snapshot())); }
  else if (mod && k === 'y') { e.preventDefault(); restore(history.redo(snapshot())); }
  else if (mod && k === 's') { e.preventDefault(); savePNG(); }
  else if (mod && k === 'c') { e.preventDefault(); copyPNG(); }
  else if (mod) return;
  else if (e.key === 'Enter' && state.crop) applyCrop();
  else if (e.key === 'Escape') {
    if (state.crop) cancelCrop();
    state.selected = -1;
    render();
    updateButtons();
  }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected >= 0) { e.preventDefault(); deleteSelected(); }
  else if (TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
});

$('undo').addEventListener('click', () => restore(history.undo(snapshot())));
$('redo').addEventListener('click', () => restore(history.redo(snapshot())));
$('delete').addEventListener('click', deleteSelected);
$('crop-apply').addEventListener('click', applyCrop);
$('crop-cancel').addEventListener('click', () => { cancelCrop(); render(); });
window.addEventListener('resize', () => { layout(); render(); });

// ---- settings controls -----------------------------------------------------

for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));

function setColor(c) {
  settings.color = c;
  $('color').value = c;
  saveSettings(settings);
  restyleSelected({ color: c });
}
for (const c of SWATCHES) {
  const b = document.createElement('button');
  b.style.background = c;
  b.title = c;
  b.addEventListener('click', () => setColor(c));
  $('swatches').append(b);
}
$('color').value = settings.color;
$('color').addEventListener('change', (e) => setColor(e.target.value));

$('width').value = settings.width;
$('width').addEventListener('change', (e) => {
  settings.width = Number(e.target.value);
  saveSettings(settings);
  restyleSelected({ width: settings.width });
});
$('text-size').value = settings.textSize;
$('text-size').addEventListener('change', (e) => {
  settings.textSize = Number(e.target.value);
  saveSettings(settings);
  restyleSelected({ size: settings.textSize });
});
function showCensorText() {
  $('censor-text-label').hidden = settings.censorMode !== 'label';
}
$('censor-mode').value = settings.censorMode;
showCensorText();
$('censor-text').value = settings.censorText;
// 'change' (not 'input') so a whole edit is one undo step on a selected label.
$('censor-text').addEventListener('change', (e) => {
  settings.censorText = e.target.value;
  saveSettings(settings);
  if (state.shapes[state.selected]?.type === 'censor') restyleSelected({ text: settings.censorText });
});
$('censor-mode').addEventListener('change', (e) => {
  settings.censorMode = e.target.value;
  showCensorText();
  saveSettings(settings);
  restyleSelected({ mode: settings.censorMode });
});

// ---- autosave --------------------------------------------------------------

// PNG-encoding the base is the expensive part, and it only changes on
// load/crop/resize, so cache one encode per base canvas.
const baseBlobs = new WeakMap();
let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!state.base) return;
    try {
      if (!baseBlobs.has(state.base)) baseBlobs.set(state.base, canvasToBlob(state.base));
      await saveSession({ image: await baseBlobs.get(state.base), shapes: state.shapes, name: state.name });
    } catch (err) {
      status(`Autosave failed: ${err.message}`, 'bad');
    }
  }, 500);
}

async function restoreSession() {
  try {
    const s = await loadSession();
    if (!s?.image) return;
    const canvas = await blobToCanvas(s.image);
    baseBlobs.set(canvas, Promise.resolve(s.image));
    setImage(canvas, s.name);
    state.shapes = s.shapes ?? [];
    history.clear();
    changed();
  } catch (err) {
    status(`Couldn't restore last session: ${err.message}`, 'bad');
  }
}

setTool(settings.tool);
updateButtons();
restoreSession();

window.annotator = { state, history }; // console access
