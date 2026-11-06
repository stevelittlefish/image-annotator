# Backlog

Roughly ordered. Check items off as they land.

Completed sections and items live in `docs/backlog-archive.md` — move them there rather
than deleting them, so this file only shows outstanding work.

## M1 — First working version

- [x] Go server: config.toml, embedded/on-disk `web/`, `/api/health`, graceful shutdown
- [x] Load image via Open, paste (Ctrl+V) or drag-and-drop
- [x] Crop (drag, Enter to apply) and Resize dialog (px / %, keep aspect)
- [x] Line, arrow (Shift snaps to 45°), box, freehand pen, text, censor box
      (solid or pixelate)
- [x] Select / move / delete annotations; restyle the selected one from the toolbar
- [x] Undo / redo across all edits including crop and resize
- [x] Save PNG and copy PNG to clipboard
- [x] Autosave the working image + annotations to IndexedDB; tool settings in localStorage

## Next

- [ ] Clipboard copy only works on https or localhost — document / add a TLS option
      if it's served over the LAN
- [ ] Resize handles on selected shapes (currently move-only)
- [ ] Zoom beyond fit-to-window for annotating large screenshots precisely
- [ ] Filled / highlighter box variant
- [ ] Numbered step markers (①②③)
- [ ] Browser test for the canvas paths (smoke test exists only as an ad-hoc CDP script)
