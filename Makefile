.PHONY: build run vet test fmt release

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

build:
	go build -o bin/image-annotator ./cmd/image-annotator

# Cross-compiled single-binary releases with web/ embedded.
release:
	@mkdir -p dist
	@for pair in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64; do \
		os=$${pair%/*}; arch=$${pair#*/}; \
		out=dist/image-annotator-$(VERSION)-$$os-$$arch; \
		[ $$os = windows ] && out=$$out.exe; \
		echo "building $$out"; \
		GOOS=$$os GOARCH=$$arch CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o $$out ./cmd/image-annotator || exit 1; \
	done

run:
	go run ./cmd/image-annotator

vet:
	go vet ./...

test:
	go test ./...
	npm test

fmt:
	gofmt -w cmd internal embed.go
