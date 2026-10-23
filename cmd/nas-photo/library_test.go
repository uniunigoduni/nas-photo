package main

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func newLibraryTestApp(t *testing.T, paths ...string) *app {
	t.Helper()
	db, err := openIndexDB(filepath.Join(t.TempDir(), "index.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	roots := make([]Root, len(paths))
	for i, path := range paths {
		roots[i] = Root{ID: filepath.Base(path), Path: path, Name: filepath.Base(path)}
	}
	return &app{
		st: &store{Settings: Settings{Roots: roots}}, db: db,
		allowed: paths, log: slog.New(slog.NewTextHandler(io.Discard, nil)), cacheDir: t.TempDir(),
		sessions: map[string]time.Time{"test-session": time.Now().Add(time.Hour)},
		// Tests explicitly scan after commits, with no goroutine outliving the DB.
		uploadRescanRunning: true,
	}
}

func writeLibraryFile(t *testing.T, root, rel, content string) string {
	t.Helper()
	path := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func libraryRequest(a *app, method, target string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, nil)
	request.AddCookie(&http.Cookie{Name: "nas_photo_session", Value: "test-session"})
	response := httptest.NewRecorder()
	if target == "/api/media" || strings.HasPrefix(target, "/api/media?") {
		a.media(response, request)
	} else {
		a.mediaByID(response, request)
	}
	return response
}

func TestOriginalMediaDragDownload(t *testing.T) {
	root := t.TempDir()
	const name = "写真.jpg"
	const content = "original full-size image bytes"
	writeLibraryFile(t, root, name, content)
	a := newLibraryTestApp(t, root)
	a.rescan(t.Context())
	items, _ := libraryPage(t, a, "")
	if len(items) != 1 {
		t.Fatalf("expected one media item, got %d", len(items))
	}
	url := "/api/media/" + items[0].ID + "/content"
	response := libraryRequest(a, http.MethodGet, url+"?download=1")
	if response.Code != http.StatusOK || response.Body.String() != content {
		t.Fatalf("download did not return original bytes: %d %q", response.Code, response.Body.String())
	}
	disposition, params, err := mime.ParseMediaType(response.Header().Get("Content-Disposition"))
	if err != nil || disposition != "attachment" || params["filename"] != name {
		t.Fatalf("original filename not preserved: %q (%v)", response.Header().Get("Content-Disposition"), err)
	}
	inline := libraryRequest(a, http.MethodGet, url)
	if inline.Code != http.StatusOK || inline.Header().Get("Content-Disposition") != "" {
		t.Fatal("normal viewer content must remain inline")
	}
}

func libraryPage(t *testing.T, a *app, query string) ([]Item, int) {
	t.Helper()
	response := libraryRequest(a, http.MethodGet, "/api/media?"+query)
	var page struct {
		Items []Item `json:"items"`
		Total int    `json:"total"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode library: %v; %s", err, response.Body.String())
	}
	return page.Items, page.Total
}

func TestDuplicateFilterVerifiesBytesAndGroupsBeforePagination(t *testing.T) {
	left, right := t.TempDir(), t.TempDir()
	writeLibraryFile(t, left, "a.jpg", "abc")
	writeLibraryFile(t, right, "z.jpg", "abc")
	writeLibraryFile(t, left, "b.gif", "def")
	writeLibraryFile(t, right, "y.gif", "def")
	writeLibraryFile(t, left, "c.gif", "def")
	writeLibraryFile(t, left, "different.jpg", "xyz")
	writeLibraryFile(t, left, "alone.jpg", "different size")
	writeLibraryFile(t, left, filepath.Join(trashDirName, "old", "trash.jpg"), "abc")
	a := newLibraryTestApp(t, left, right)
	a.rescan(t.Context())
	items, total := libraryPage(t, a, "condition=duplicates&sort=name&order=asc")
	if total != 5 || len(items) != 5 {
		t.Fatalf("expected 5 exact duplicates, got %d: %#v", total, items)
	}
	for i, name := range []string{"a.jpg", "z.jpg", "b.gif", "c.gif", "y.gif"} {
		if items[i].Name != name {
			t.Fatalf("duplicate grouping: item %d is %s, expected %s", i, items[i].Name, name)
		}
	}
	page, _ := libraryPage(t, a, "condition=duplicates&sort=name&order=asc&offset=1&limit=1")
	if len(page) != 1 || page[0].Name != "z.jpg" {
		t.Fatalf("pagination split the grouped order: %#v", page)
	}
	// A deliberately colliding cache must still not classify xyz as abc/def.
	if _, err := a.db.Exec(`UPDATE content_hashes SET digest='collision'`); err != nil {
		t.Fatal(err)
	}
	a.refreshDuplicateGroups(t.Context())
	_, total = libraryPage(t, a, "condition=duplicates")
	if total != 5 {
		t.Fatalf("cached hash collision created a false duplicate: %d", total)
	}
	_, total = libraryPage(t, a, "")
	if total != 7 {
		t.Fatalf("trash leaked into normal library: %d", total)
	}
}

func TestMediaTypeAndDuplicateConditionAreIndependent(t *testing.T) {
	root := t.TempDir()
	for name, content := range map[string]string{
		"a.jpg": "image duplicate", "z.jpg": "image duplicate",
		"b.gif": "gif duplicate", "y.gif": "gif duplicate",
		"c.mp4": "video duplicate", "x.mov": "video duplicate",
		"alone.mp4": "unique video",
		"cross.jpg": "cross type bytes", "cross.mp4": "cross type bytes",
	} {
		writeLibraryFile(t, root, name, content)
	}
	a := newLibraryTestApp(t, root)
	a.rescan(t.Context())
	for _, tc := range []struct {
		name, query string
		total       int
		videoOnly   bool
		imageOnly   bool
	}{
		{"all without condition", "", 9, false, false},
		{"images without condition", "filter=image", 5, false, true},
		{"videos without condition", "filter=video&condition=", 4, true, false},
		{"all duplicates", "condition=duplicates", 8, false, false},
		{"image duplicates", "filter=image&condition=duplicates", 5, false, true},
		{"video duplicates", "filter=video&condition=duplicates", 3, true, false},
		{"legacy duplicate request", "filter=duplicates", 8, false, false},
		{"explicit no condition", "filter=duplicates&condition=", 9, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			items, total := libraryPage(t, a, tc.query)
			if total != tc.total || len(items) != tc.total {
				t.Fatalf("expected %d items, got %d: %#v", tc.total, total, items)
			}
			for _, item := range items {
				if (tc.videoOnly && item.Kind != "video") || (tc.imageOnly && item.Kind == "video") {
					t.Fatalf("media type filter leaked %s (%s)", item.Name, item.Kind)
				}
			}
		})
	}
	// Duplicate status is based on the whole library, including another type.
	// Grouping still happens after type selection and before pagination.
	page, total := libraryPage(t, a, "filter=video&condition=duplicates&sort=name&order=asc&offset=1&limit=1")
	if total != 3 || len(page) != 1 || page[0].Name != "x.mov" {
		t.Fatalf("combined filter lost duplicate grouping before pagination: %#v, total %d", page, total)
	}
}

func TestTrashRetainsOriginalAndSurvivesScanRestartAndManualRestore(t *testing.T) {
	root := t.TempDir()
	original := writeLibraryFile(t, root, "album/photo.jpg", "original bytes")
	writeLibraryFile(t, root, "copy.jpg", "original bytes")
	a := newLibraryTestApp(t, root)
	a.rescan(t.Context())
	itemID := stableID(a.st.Roots[0].ID, filepath.Join("album", "photo.jpg"))
	var selected Item
	for _, item := range a.items {
		if item.ID == itemID {
			selected = item
		}
	}
	_, thumbnail := a.thumbnailPath(selected)
	if err := os.WriteFile(thumbnail, []byte("cached preview"), 0600); err != nil {
		t.Fatal(err)
	}
	response := libraryRequest(a, http.MethodPost, "/api/media/"+itemID+"/trash")
	if response.Code != http.StatusOK {
		t.Fatalf("trash failed: %d %s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(original); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("source was not moved: %v", err)
	}
	matches, err := filepath.Glob(filepath.Join(root, trashDirName, "*", "album", "photo.jpg"))
	if err != nil || len(matches) != 1 {
		t.Fatalf("original hierarchy not retained: %v %v", matches, err)
	}
	if content, err := os.ReadFile(matches[0]); err != nil || string(content) != "original bytes" {
		t.Fatalf("trash lost media bytes: %q %v", content, err)
	}
	for _, suffix := range []string{"", "/content", "/thumbnail"} {
		if got := libraryRequest(a, http.MethodGet, "/api/media/"+itemID+suffix); got.Code != http.StatusNotFound {
			t.Fatalf("trashed media still served via %s: %d", suffix, got.Code)
		}
	}
	if _, total := libraryPage(t, a, "condition=duplicates"); total != 0 {
		t.Fatal("the sole remaining copy is still a duplicate")
	}
	a.rescan(t.Context())
	a.loadCatalog()
	if len(a.items) != 1 {
		t.Fatalf("scan/reload resurrected trash: %#v", a.items)
	}
	if err := os.Rename(matches[0], original); err != nil {
		t.Fatal(err)
	}
	a.rescan(t.Context())
	if _, total := libraryPage(t, a, "condition=duplicates"); total != 2 {
		t.Fatalf("manual restore was not indexed: %d", total)
	}
}

func TestTrashFailurePreservesMediaAndIndex(t *testing.T) {
	for _, reason := range []string{"trash-path-is-file", "database-closed", "source-changed"} {
		t.Run(reason, func(t *testing.T) {
			root := t.TempDir()
			path := writeLibraryFile(t, root, "photo.jpg", "abc")
			a := newLibraryTestApp(t, root)
			a.rescan(t.Context())
			switch reason {
			case "trash-path-is-file":
				writeLibraryFile(t, root, trashDirName, "do not replace")
			case "database-closed":
				_ = a.db.Close()
			case "source-changed":
				writeLibraryFile(t, root, "photo.jpg", "changed content")
			}
			if err := a.moveMediaToTrash(a.items[0].ID); err == nil {
				t.Fatal("unsafe move succeeded")
			}
			if _, err := os.Stat(path); err != nil || len(a.items) != 1 {
				t.Fatalf("failed move lost original or index: %v %#v", err, a.items)
			}
		})
	}
}

func TestTrashAndScanCannotResurrectSelectedFile(t *testing.T) {
	root := t.TempDir()
	writeLibraryFile(t, root, "photo.jpg", "abc")
	a := newLibraryTestApp(t, root)
	a.rescan(t.Context())
	itemID := a.items[0].ID
	var wg sync.WaitGroup
	wg.Go(func() { a.rescan(t.Context()) })
	wg.Go(func() {
		if err := a.moveMediaToTrash(itemID); err != nil {
			t.Errorf("move: %v", err)
		}
	})
	wg.Wait()
	a.loadCatalog()
	if len(a.items) != 0 {
		t.Fatalf("concurrent scan restored trashed ID: %#v", a.items)
	}
}

func TestTrashRejectsNonPostAndUnconfiguredRoot(t *testing.T) {
	root := t.TempDir()
	path := writeLibraryFile(t, root, "photo.jpg", "abc")
	a := newLibraryTestApp(t, root)
	a.rescan(t.Context())
	itemID := a.items[0].ID
	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		if response := libraryRequest(a, method, "/api/media/"+itemID+"/trash"); response.Code != http.StatusMethodNotAllowed {
			t.Fatalf("unexpected method %s: %d", method, response.Code)
		}
	}
	a.st.Roots = nil
	if err := a.moveMediaToTrash(itemID); err == nil {
		t.Fatal("unconfigured root was modified")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("method/root checks lost original")
	}
}

func TestTrashFolderCannotBeSelectedOrFollowedThroughSymlink(t *testing.T) {
	root := t.TempDir()
	trash := filepath.Join(root, trashDirName)
	if err := os.Mkdir(trash, 0755); err != nil {
		t.Fatal(err)
	}
	a := newLibraryTestApp(t, root)
	if _, err := a.validRoots([]string{trash}); err == nil {
		t.Fatal("trash folder can be selected as a root")
	}
	link := filepath.Join(root, "alias")
	if err := os.Symlink(trash, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := a.validRoots([]string{link}); err == nil {
		t.Fatal("a symlink made trash selectable")
	}
}

func TestUploadDedupUsesLiveFoldersAndChecksWithinBatch(t *testing.T) {
	for _, scenario := range []string{"unindexed-other-root", "within-batch", "trash-only", "same-size-different"} {
		t.Run(scenario, func(t *testing.T) {
			useUploadTempRoot(t)
			left, right := t.TempDir(), t.TempDir()
			a := newLibraryTestApp(t, left, right)
			batch := validTestUploadBatch(left, 3)
			batch.State = uploadStateReady
			batch.Files[0].Uploaded = true
			wantSaved, wantSkipped := 1, 0
			switch scenario {
			case "unindexed-other-root":
				writeLibraryFile(t, right, "different-name.gif", "abc")
				wantSaved, wantSkipped = 0, 1
			case "within-batch":
				batch.Files = append(batch.Files,
					uploadFile{Index: 1, Name: "copy.jpg", SourcePath: "copy.jpg", Size: 3, Uploaded: true},
					uploadFile{Index: 2, Name: "different.jpg", SourcePath: "different.jpg", Size: 3, Uploaded: true})
				wantSaved, wantSkipped = 2, 1
			case "trash-only":
				writeLibraryFile(t, right, filepath.Join(trashDirName, "old", "photo.jpg"), "abc")
			case "same-size-different":
				writeLibraryFile(t, right, "photo.jpg", "xyz")
			}
			for i := range batch.Files {
				part, _, err := uploadPartPaths(batch.ID, i)
				if err != nil {
					t.Fatal(err)
				}
				content := "abc"
				if i == 2 {
					content = "xyz"
				}
				if err := os.WriteFile(part, []byte(content), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := saveUploadBatch(batch); err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			a.commitUploadBatch(response, batch.ID)
			if response.Code != http.StatusOK {
				t.Fatalf("commit failed: %d %s", response.Code, response.Body.String())
			}
			var result struct {
				Batch uploadBatchView `json:"batch"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Batch.SavedCount != wantSaved || result.Batch.SkippedCount != wantSkipped {
				t.Fatalf("expected saved=%d skipped=%d, got %+v", wantSaved, wantSkipped, result.Batch)
			}
			destination, err := uploadDestinationPath(left, batch.DateFolder, false)
			if err != nil {
				t.Fatal(err)
			}
			files, err := os.ReadDir(destination)
			if err != nil || len(files) != wantSaved {
				t.Fatalf("unexpected saved originals: %d %v", len(files), err)
			}
		})
	}
}

func TestSkippedUploadIsReverifiedBeforeTempCleanup(t *testing.T) {
	useUploadTempRoot(t)
	root := t.TempDir()
	candidate := writeLibraryFile(t, root, "existing.jpg", "abc")
	a := newLibraryTestApp(t, root)
	batch := validTestUploadBatch(root, 3)
	part, _, err := uploadPartPaths(batch.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(part, []byte("abc"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := a.markDuplicateUploads(t.Context(), batch, root); err != nil || !batch.Files[0].Skipped {
		t.Fatalf("duplicate not marked: %v", err)
	}
	if err := os.Remove(candidate); err != nil {
		t.Fatal(err)
	}
	if err := verifySkippedUploads(batch, root); err == nil {
		t.Fatal("missing duplicate allowed upload temp cleanup")
	}
	if content, err := os.ReadFile(part); err != nil || string(content) != "abc" {
		t.Fatal("retryable upload was lost")
	}
}
