# Image Annotator

A lightweight browser app for marking up images (typically screenshots): load or
paste an image, crop/resize, draw lines, arrows, boxes, freehand and text, add
censor boxes, then save as PNG or copy to the clipboard. Sibling project to MagicPaint
(`~/git/magicpaint`) and follows the same house style: Go single binary serving a
plain-JS frontend, no framework, no bundler.

## Architecture

- **Frontend:** Plain JavaScript (ES modules, no framework, no build step). Owns the
  document model: images, annotations, undo history, tools, viewport (pan/zoom),
  rendering (Canvas 2D), import/export.
- **Storage:** Local to the browser. Images and annotations persist client-side —
  image blobs in IndexedDB (localStorage's ~5 MB quota is too small for images),
  small settings/UI state in localStorage. Nothing is uploaded to a server.
- **Backend:** Go, single binary, stdlib-first (`net/http`). Serves the static
  frontend (embedded for releases, on-disk in development). Kept deliberately thin.

```
browser (editor, document model, IndexedDB/localStorage)
   │ HTTP
go backend (static files)
```

## Repo layout

```
cmd/image-annotator/  # main.go — serves web/ and /api/health
internal/config/      # config.toml loading
web/js/model.js       # pure logic: shapes, hit testing, crop/resize transforms, undo history
web/js/render.js      # Canvas 2D drawing of base image + shapes, overlays
web/js/storage.js     # IndexedDB session autosave, localStorage settings
web/js/app.js         # UI wiring: tools, pointer/keyboard, load/paste/drop, export
docs/                 # design notes, backlog archive
embed.go              # embeds web/ for single-binary releases
```

## Document model

- The base image is an **immutable canvas**: crop and resize create a new canvas and
  never draw on the old one, so undo snapshots can share it safely.
- Annotations are **vector shapes** (plain JSON in image pixel coordinates) kept
  editable until export. Crop translates them; resize scales them (stroke width and
  text size scale too).
- Undo is snapshot-based (`History` in `model.js`): call `commit(fn)` in `app.js` for
  any change so it's undoable and autosaved.
- Export flattens base + shapes at native resolution. Censor boxes are only
  burned in at export; pixelate writes block averages with `putImageData`, so
  nothing underneath shows through.
- Clipboard copy needs a secure context (https or localhost).

## Conventions

- Go: stdlib where possible. `go vet` and `gofmt` clean. Module path
  `seaslug.io/steve/image-annotator`.
- Server prefers on-disk `web/` (live edits in dev) and falls back to the embedded
  copy — same `chooseFS` pattern as MagicPaint.
- JS: ES modules, no framework, no bundler. Canvas 2D for rendering.
- Config via `config.toml` in the repo root (loaded with BurntSushi/toml) — no env
  vars, no per-setting flags (except `-config`). `./run.sh` runs from source on :8481.
- Make targets: `build`, `run`, `vet`, `test`, `fmt`, `release` (cross-compiled,
  `CGO_ENABLED=0`, `-trimpath -ldflags="-s -w"`).
- Tests: Go unit tests for the backend; frontend logic as `node:test` suites in
  `web/js/*.test.js`, aggregated by `web/js/tests.js` and run via `npm test`
  (no dependencies). Modules needing real canvas/DOM get a browser test that
  self-skips when no Chrome is available.
- CI: `.gitea/workflows/ci.yaml` — gofmt check, go vet, go test, npm test.
- Deploy: multi-stage Dockerfile (golang:alpine → alpine), `docker-compose.yml`
  mounting `config.toml` read-only.
- UI: dark theme via CSS custom properties, `system-ui` font, native `<details>`
  menus, `<dialog>` for modals.

## Working docs

- `BACKLOG.md` — todo items, roughly ordered. Tick items off in place as they land
- `docs/backlog-archive.md` — record of what shipped. **Do not archive anything
  unless explicitly asked.** Leave completed items ticked off in `BACKLOG.md`; when
  asked for an archive pass, move them here verbatim rather than deleting them

## Reports and generated docs

- **Never publish reports as Claude Artifacts.** Any report, review, or write-up goes
  in `docs/` as a file committed to the repo — no hosted links, no external services.
- HTML reports must be **valid, standalone HTML files**: `<!doctype html>`,
  `<html lang>`, `<head>` with charset and viewport, `<title>`, `<body>`, everything
  closed. Fully self-contained (inline CSS/JS, no CDN links, external fonts or
  images) so they open from `file://`. Include a minimal reset.
- Prefer system font stacks and `prefers-color-scheme` for dark mode.
- Name reports `docs/<topic>-<YYYY-MM-DD>.<ext>`.
