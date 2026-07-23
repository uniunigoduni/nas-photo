package main

import (
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSortItemsIsStableAndRespectsOrder(t *testing.T) {
	now := time.Now()
	items := []Item{
		{ID: "b", Name: "same.jpg", Modified: now},
		{ID: "a", Name: "same.jpg", Modified: now},
		{ID: "c", Name: "z.jpg", Modified: now.Add(time.Hour)},
	}
	sortItems(items, "modified", "asc")
	if items[0].ID != "a" || items[1].ID != "b" || items[2].ID != "c" {
		t.Fatalf("unexpected ascending order: %#v", items)
	}
	sortItems(items, "modified", "desc")
	if items[0].ID != "c" {
		t.Fatalf("unexpected descending order: %#v", items)
	}
}

func TestDefaultSplitToggleShortcut(t *testing.T) {
	if got := defaults()["splitToggle"]; got != "KeyE" {
		t.Fatalf("unexpected split toggle shortcut: %q", got)
	}
}

func TestDefaultMuteShortcut(t *testing.T) {
	if got := defaults()["mute"]; got != "KeyM" {
		t.Fatalf("unexpected mute shortcut: %q", got)
	}
}

func TestStoreLoadAddsNewShortcutDefaults(t *testing.T) {
	file := filepath.Join(t.TempDir(), "settings.json")
	if err := os.WriteFile(file, []byte(`{"shortcuts":{"prev1":"KeyZ"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	s := &store{file: file}
	if err := s.load(); err != nil {
		t.Fatal(err)
	}
	if s.Shortcuts["prev1"] != "KeyZ" {
		t.Fatalf("existing shortcut was not preserved: %#v", s.Shortcuts)
	}
	if s.Shortcuts["splitToggle"] != "KeyE" {
		t.Fatalf("new shortcut default was not added: %#v", s.Shortcuts)
	}
	if s.Shortcuts["mute"] != "KeyM" {
		t.Fatalf("new mute shortcut default was not added: %#v", s.Shortcuts)
	}
}

func TestWebDefaultsToEnglishWithoutSetupStepCounters(t *testing.T) {
	content, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	if !strings.Contains(source, "localStorage.getItem('nas-photo-language') || 'en'") {
		t.Fatal("web UI does not default to English")
	}
	if strings.Contains(source, `class="step"`) {
		t.Fatal("setup step counters are still rendered")
	}
	if !strings.Contains(source, `id="default-shortcuts"`) {
		t.Fatal("shortcut defaults button is missing")
	}
}

func TestMakeImageThumbnail(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.jpg")
	target := filepath.Join(dir, "thumb.jpg")
	img := image.NewRGBA(image.Rect(0, 0, 1200, 600))
	for y := 0; y < 600; y++ {
		for x := 0; x < 1200; x++ {
			img.Set(x, y, color.RGBA{R: 70, G: 120, B: 190, A: 255})
		}
	}
	file, err := os.Create(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(file, img, nil); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if err := makeImageThumbnail(source, target); err != nil {
		t.Fatal(err)
	}
	thumb, err := os.Open(target)
	if err != nil {
		t.Fatal(err)
	}
	defer thumb.Close()
	config, err := jpeg.DecodeConfig(thumb)
	if err != nil {
		t.Fatal(err)
	}
	if config.Width != 480 || config.Height != 240 {
		t.Fatalf("unexpected thumbnail size: %dx%d", config.Width, config.Height)
	}
}
