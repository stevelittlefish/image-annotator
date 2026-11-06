package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestHandlerServesIndexAndHealth(t *testing.T) {
	web := fstest.MapFS{"index.html": {Data: []byte("<!doctype html>hi")}}
	h := newHandler(web)
	for _, path := range []string{"/", "/api/health"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", path, rec.Code)
		}
	}
}
