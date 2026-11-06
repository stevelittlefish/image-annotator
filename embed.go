// Package assets embeds the frontend into the binary so a release build is a
// single self-contained file. The server prefers the on-disk copy (for
// development) and falls back to this when it is absent — see
// cmd/image-annotator/main.go.
package assets

import (
	"embed"
	"io/fs"
)

//go:embed all:web
var webFS embed.FS

// Web is the embedded frontend, rooted at web/'s contents (index.html at "/").
var Web = func() fs.FS {
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		panic(err)
	}
	return sub
}()
