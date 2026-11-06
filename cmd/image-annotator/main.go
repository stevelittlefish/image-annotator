package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	assets "seaslug.io/steve/image-annotator"
	"seaslug.io/steve/image-annotator/internal/config"
)

func main() {
	configPath := flag.String("config", "config.toml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatal(err)
	}

	log.Printf("image-annotator listening on %s", cfg.Listen)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	handler := newHandler(chooseFS(cfg.WebDir, assets.Web))
	if err := runHTTPServer(ctx, newHTTPServer(cfg.Listen, handler)); err != nil {
		log.Fatal(err)
	}
}

func newHandler(web fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"ok":true}`)
	})
	mux.Handle("GET /", http.FileServerFS(web))
	return mux
}

func newHTTPServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    1 << 20,
	}
}

func runHTTPServer(ctx context.Context, server *http.Server) error {
	errs := make(chan error, 1)
	go func() { errs <- server.ListenAndServe() }()

	select {
	case err := <-errs:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		log.Printf("shutting down HTTP server")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("graceful HTTP shutdown: %w", err)
		}
		if err := <-errs; !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
}

// chooseFS prefers an on-disk directory (for development, so edits are live)
// and falls back to the embedded copy — the case for a single-binary release.
func chooseFS(dir string, embedded fs.FS) fs.FS {
	if info, err := os.Stat(dir); err == nil && info.IsDir() {
		log.Printf("serving web from disk: %s", dir)
		return os.DirFS(dir)
	}
	log.Printf("serving web from embedded assets")
	return embedded
}
