package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSafeUploadNameRemovesClientPath(t *testing.T) {
	name, err := safeUploadName(`folder\nested\photo.JPG`)
	if err != nil {
		t.Fatal(err)
	}
	if name != "photo.JPG" {
		t.Fatalf("unexpected upload name: %q", name)
	}
	if kind(name) != "image" {
		t.Fatalf("sanitized upload name is no longer recognized: %q", name)
	}
}

func TestUploadBatchExpiresAfterOneHourOfInactivity(t *testing.T) {
	now := time.Now()
	batch := &uploadBatch{LastActivityAt: now.Add(-uploadBatchTTL)}
	if !uploadBatchExpired(batch, now) {
		t.Fatal("upload batch did not expire after the configured inactivity TTL")
	}
	batch.LastActivityAt = now.Add(-uploadBatchTTL + time.Second)
	if uploadBatchExpired(batch, now) {
		t.Fatal("active upload batch expired before the configured inactivity TTL")
	}
}

func TestNextUploadTargetNameAvoidsExistingAndReservedNames(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "IMG_0001.JPG"), []byte("existing"), 0600); err != nil {
		t.Fatal(err)
	}
	reserved := map[string]bool{uploadNameKey("IMG_0001_2.JPG"): true}
	name, err := nextUploadTargetName(dir, "IMG_0001.JPG", reserved)
	if err != nil {
		t.Fatal(err)
	}
	if name != "IMG_0001_3.JPG" {
		t.Fatalf("unexpected collision-safe name: %q", name)
	}
}

func TestSameUploadFilesUsesSourcePathAndSize(t *testing.T) {
	left := []uploadFile{{Index: 0, Name: "photo.jpg", SourcePath: "a/photo.jpg", Size: 10}}
	right := []uploadFile{{Index: 0, Name: "photo.jpg", SourcePath: "a/photo.jpg", Size: 10}}
	if !sameUploadFiles(left, right) {
		t.Fatal("identical upload manifests were not matched")
	}
	right[0].SourcePath = "b/photo.jpg"
	if sameUploadFiles(left, right) {
		t.Fatal("different source paths were incorrectly treated as the same batch")
	}
}

func TestUploadWebShellLoadsDragAndDropAssets(t *testing.T) {
	index, err := assets.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	shell := string(index)
	for _, expected := range []string{"upload.css", "upload.js"} {
		if !strings.Contains(shell, expected) {
			t.Fatalf("web shell is missing %q", expected)
		}
	}
	script, err := assets.ReadFile("web/upload.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(script)
	for _, expected := range []string{"webkitGetAsEntry", "getAsFileSystemHandle", "walkWebkitEntry", "SUPPORTED_EXTENSIONS"} {
		if !strings.Contains(source, expected) {
			t.Fatalf("drag-and-drop folder support is missing %q", expected)
		}
	}
}
