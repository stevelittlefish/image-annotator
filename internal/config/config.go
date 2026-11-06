// Package config loads Image Annotator's config.toml.
package config

import (
	"fmt"

	"github.com/BurntSushi/toml"
)

type Config struct {
	Listen string `toml:"listen"`
	WebDir string `toml:"web_dir"`
}

// Load reads path, applying defaults for unset fields. A missing file is an
// error: the config file is the single source of settings.
func Load(path string) (*Config, error) {
	cfg := &Config{Listen: ":8481", WebDir: "web"}
	if _, err := toml.DecodeFile(path, cfg); err != nil {
		return nil, fmt.Errorf("loading config %s: %w", path, err)
	}
	return cfg, nil
}
