# Image Annotator

> **Quick and dirty.** A small personal tool knocked together to mark up
> screenshots. No releases, no stability promises, no support. Use it if it's
> handy; don't build anything important on it.

Load or paste an image, scribble on it, and get a PNG back out. Everything stays in
your browser: nothing is uploaded anywhere.

![icon](web/icon.svg)

## What it does

- **Get an image in:** paste (Ctrl+V), drag and drop, or Open
- **Crop and resize**
- **Draw:** lines, arrows, boxes, freehand, text
- **Censor boxes:** solid black, pixelate, or *label*, which is a magenta box with
  cyan text auto-sized to fill it
- **Move, restyle or delete** annotations after drawing them
- **Undo/redo** for everything (100 levels)
- **Get it out:** Save PNG (Ctrl+S) or copy to the clipboard (Ctrl+C)
- **Autosave:** your current image and annotations survive a page reload (stored
  in the browser's IndexedDB)

### Shortcuts

| Key | Tool | | Key | Action |
|---|---|---|---|---|
| V | Select / move | | Ctrl+V | Paste image |
| C | Crop (Enter to apply) | | Ctrl+C | Copy PNG |
| L | Line | | Ctrl+S | Save PNG |
| A | Arrow (Shift snaps to 45°) | | Ctrl+Z | Undo |
| R | Box | | Ctrl+Shift+Z | Redo |
| P | Freehand | | Del | Delete selected |
| T | Text | | Esc | Cancel / deselect |
| X | Censor | | | |

## Running it

Needs Go 1.26+.

```sh
./run.sh            # serves on http://localhost:8481
```

Or with Docker:

```sh
docker compose up -d --build
```

Settings (just the listen address) live in `config.toml`.

## Caveats

- **Clipboard copy only works on https or localhost.** Over plain http on your LAN,
  use Save PNG.
- **Pixelate isn't secure redaction.** Use solid or label for anything that matters.
- Shapes can be moved but not resized after drawing, and there's no zoom beyond
  fit-to-window.
- Only tested in Chromium-based browsers (Chrome, Brave) on Linux.
- Undo history isn't saved across reloads.

## Development

Go backend (stdlib, serves the static files), plain JS frontend (ES modules, no
framework, no build step). See [`CLAUDE.md`](CLAUDE.md) for conventions and
[`BACKLOG.md`](BACKLOG.md) for what's next.

```sh
make test           # go test + node:test frontend tests
make vet
make release        # cross-compiled single binaries in dist/
```
