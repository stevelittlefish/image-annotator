#!/bin/sh
# Run Image Annotator from source using config.toml in the repo root.
cd "$(dirname "$0")"
exec go run ./cmd/image-annotator "$@"
