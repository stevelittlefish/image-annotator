# Build stage: compile the single self-contained binary (web/ is embedded via
# embed.go, so the runtime image needs no asset files).
FROM golang:1.26-alpine AS build

WORKDIR /src

# Dependencies first so they cache across source edits.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/image-annotator ./cmd/image-annotator

FROM alpine:3.22

WORKDIR /app
COPY --from=build /out/image-annotator /usr/local/bin/image-annotator

EXPOSE 8481
ENTRYPOINT ["image-annotator"]
CMD ["-config", "/app/config.toml"]
