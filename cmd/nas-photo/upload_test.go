package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func useUploadTempRoot(t *testing.T) string {
	t.Helper()
	previous := uploadTempRootTest
	uploadTempRootTest = t.TempDir()
	t.Cleanup(func() { uploadTempRootTest = previous })
	return uploadTempRootTest
}

func validTestUploadBatch(root string, size int64) *uploadBatch {
	now := time.Now()
	return &uploadBatch{
		ID:             "test-batch",
		State:          uploadStateUploading,
		CreatedAt:      now,
		LastActivityAt: now,
		DateFolder:     now.Format("20060102"),
		RootPath:       filepath.Clean(root),
		RootName:       filepath.Base(root),
		Files: []uploadFile{{
			Index: 0, Name: "photo.jpg", SourcePath: "folder/photo.jpg", Size: size,
		}},
	}
}

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

func TestLoadUploadBatchRejectsPersistedTraversalFields(t *testing.T) {
	tempRoot := useUploadTempRoot(t)
	root := t.TempDir()
	batch := validTestUploadBatch(root, 3)
	batch.Files[0].TargetName = "../outside.jpg"
	dir := filepath.Join(tempRoot, batch.ID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	content, err := json.Marshal(batch)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, uploadManifestName), content, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadUploadBatch(batch.ID); err == nil {
		t.Fatal("persisted target-name traversal was accepted")
	}

	batch.Files[0].TargetName = "photo.jpg"
	batch.DateFolder = "../../outside"
	content, err = json.Marshal(batch)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, uploadManifestName), content, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadUploadBatch(batch.ID); err == nil {
		t.Fatal("persisted date-folder traversal was accepted")
	}
}

func TestReceiveUploadFileRejectsShortAndLongBodies(t *testing.T) {
	useUploadTempRoot(t)
	root := t.TempDir()
	tests := []struct {
		name string
		body string
	}{
		{name: "short", body: "ab"},
		{name: "long", body: "abcd"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			batch := validTestUploadBatch(root, 3)
			batch.ID = "test-" + test.name
			if err := saveUploadBatch(batch); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPut, "/api/uploads/batches/"+batch.ID+"/files/0", strings.NewReader(test.body))
			response := httptest.NewRecorder()
			(&app{}).receiveUploadFile(response, request, batch.ID, 0)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("unexpected status for %s body: %d", test.name, response.Code)
			}
			loaded, err := loadUploadBatch(batch.ID)
			if err != nil {
				t.Fatal(err)
			}
			if loaded.Files[0].Uploaded {
				t.Fatalf("%s body was marked as uploaded", test.name)
			}
		})
	}
}

func TestReceiveUploadFileAcceptsExactBodyWithoutLoadingItAll(t *testing.T) {
	useUploadTempRoot(t)
	batch := validTestUploadBatch(t.TempDir(), 3)
	if err := saveUploadBatch(batch); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPut, "/api/uploads/batches/"+batch.ID+"/files/0", strings.NewReader("abc"))
	response := httptest.NewRecorder()
	(&app{}).receiveUploadFile(response, request, batch.ID, 0)
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d (%s)", response.Code, response.Body.String())
	}
	loaded, err := loadUploadBatch(batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.Files[0].Uploaded || loaded.State != uploadStateReady {
		t.Fatalf("exact upload was not finalized: %+v", loaded.Files[0])
	}
}

func TestCommitFailureKeepsReceivedLocalFileForRetry(t *testing.T) {
	useUploadTempRoot(t)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, uploadDestinationDirName), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	batch := validTestUploadBatch(root, 3)
	batch.Files[0].Uploaded = true
	batch.State = uploadStateReady
	partPath, _, err := uploadPartPaths(batch.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(partPath, []byte("abc"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := saveUploadBatch(batch); err != nil {
		t.Fatal(err)
	}
	a := &app{st: &store{Settings: Settings{Roots: []Root{{Path: root}}}}, allowed: []string{root}}
	response := httptest.NewRecorder()
	a.commitUploadBatch(response, batch.ID)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("unexpected commit status: %d", response.Code)
	}
	loaded, err := loadUploadBatch(batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.State != uploadStateCommitFailed || !loaded.Files[0].Uploaded {
		t.Fatalf("commit failure did not preserve retry state: %+v", loaded)
	}
	if content, err := os.ReadFile(partPath); err != nil || string(content) != "abc" {
		t.Fatalf("received local file was not preserved: %q, %v", content, err)
	}
}

func TestCommitDoesNotWriteBeforeAllFilesAreReceived(t *testing.T) {
	useUploadTempRoot(t)
	root := t.TempDir()
	batch := validTestUploadBatch(root, 3)
	if err := saveUploadBatch(batch); err != nil {
		t.Fatal(err)
	}
	a := &app{st: &store{Settings: Settings{Roots: []Root{{Path: root}}}}, allowed: []string{root}}
	response := httptest.NewRecorder()
	a.commitUploadBatch(response, batch.ID)
	if response.Code != http.StatusConflict {
		t.Fatalf("unexpected incomplete commit status: %d", response.Code)
	}
	if _, err := os.Stat(filepath.Join(root, uploadDestinationDirName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("NAS destination was touched before the batch was complete: %v", err)
	}
}

func TestCommitRejectsBatchAfterConfiguredRootChanges(t *testing.T) {
	useUploadTempRoot(t)
	originalRoot := t.TempDir()
	newRoot := t.TempDir()
	batch := validTestUploadBatch(originalRoot, 3)
	batch.Files[0].Uploaded = true
	batch.State = uploadStateReady
	partPath, _, err := uploadPartPaths(batch.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(partPath, []byte("abc"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := saveUploadBatch(batch); err != nil {
		t.Fatal(err)
	}
	a := &app{st: &store{Settings: Settings{Roots: []Root{{Path: newRoot}}}}, allowed: []string{newRoot}}
	response := httptest.NewRecorder()
	a.commitUploadBatch(response, batch.ID)
	if response.Code != http.StatusConflict {
		t.Fatalf("unexpected changed-root status: %d", response.Code)
	}
	loaded, err := loadUploadBatch(batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.State != uploadStateCommitFailed || !loaded.Files[0].Uploaded {
		t.Fatalf("changed root did not preserve retryable upload: %+v", loaded)
	}
	if _, err := os.Stat(filepath.Join(originalRoot, uploadDestinationDirName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("old root was touched after configuration changed: %v", err)
	}
}

func TestCommitRetryDoesNotMistakeSameSizeDifferentContentForCompletedFile(t *testing.T) {
	useUploadTempRoot(t)
	root := t.TempDir()
	batch := validTestUploadBatch(root, 3)
	batch.Files[0].Uploaded = true
	batch.Files[0].TargetName = "photo.jpg"
	partPath, _, err := uploadPartPaths(batch.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(partPath, []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	destination := t.TempDir()
	if err := os.WriteFile(filepath.Join(destination, "photo.jpg"), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := planUploadTargetNames(destination, batch); err != nil {
		t.Fatal(err)
	}
	if batch.Files[0].TargetName != "photo_2.jpg" {
		t.Fatalf("different same-size file was treated as completed: %q", batch.Files[0].TargetName)
	}

	batch.Files[0].TargetName = "photo.jpg"
	if err := os.WriteFile(filepath.Join(destination, "photo.jpg"), []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := planUploadTargetNames(destination, batch); err != nil {
		t.Fatal(err)
	}
	if batch.Files[0].TargetName != "photo.jpg" {
		t.Fatalf("previously renamed identical file was not reused: %q", batch.Files[0].TargetName)
	}
}

func TestCleanupExpiredUploadsRemovesBatchAfterRestart(t *testing.T) {
	useUploadTempRoot(t)
	batch := validTestUploadBatch(t.TempDir(), 3)
	batch.LastActivityAt = time.Now().Add(-uploadBatchTTL)
	if err := saveUploadBatch(batch); err != nil {
		t.Fatal(err)
	}
	(&app{}).cleanupExpiredUploads()
	if _, err := os.Stat(uploadBatchDir(batch.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expired upload batch was not removed: %v", err)
	}
}

func TestUploadDestinationRejectsSymlinkOutsideRoot(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	link := filepath.Join(root, uploadDestinationDirName)
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks are unavailable: %v", err)
	}
	date := time.Now().Format("20060102")
	if _, err := uploadDestinationPath(root, date, true); err == nil {
		t.Fatal("upload destination symlink escaping the configured root was accepted")
	}
	if _, err := os.Stat(filepath.Join(outside, date)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("outside directory was touched before the symlink was rejected: %v", err)
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

func TestCopyUploadFileReportsProgress(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.bin")
	destination := filepath.Join(dir, "destination.bin")
	data := make([]byte, 3<<20+123)
	for i := range data {
		data[i] = byte(i)
	}
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	var last int64
	calls := 0
	err := copyUploadFile(source, destination, int64(len(data)), func(done int64) {
		if done < last {
			t.Fatalf("upload copy progress moved backwards: %d -> %d", last, done)
		}
		last = done
		calls++
	})
	if err != nil {
		t.Fatal(err)
	}
	if last != int64(len(data)) || calls < 2 {
		t.Fatalf("unexpected progress reports: last=%d calls=%d", last, calls)
	}
	info, err := os.Stat(destination)
	if err != nil || info.Size() != int64(len(data)) {
		t.Fatalf("copied file size mismatch: %v, %v", info, err)
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
	for _, expected := range []string{"webkitGetAsEntry", "getAsFileSystemHandle", "walkWebkitEntry", "SUPPORTED_EXTENSIONS", "appendDroppedFile", "!items.length || !output.length", "compareText", "dropInProgress", "UPLOAD_PHASE_WEIGHT", "commitBatchWithProgress", "/progress"} {
		if !strings.Contains(source, expected) {
			t.Fatalf("drag-and-drop folder support is missing %q", expected)
		}
	}
	collectAt := strings.Index(source, "collectDroppedFiles(event.dataTransfer)")
	authAt := strings.Index(source, "requestJSON('/api/auth/me')")
	if collectAt < 0 || authAt < 0 || collectAt > authAt {
		t.Fatal("drop data is not captured before the first asynchronous authentication request")
	}
	serviceWorker, err := assets.ReadFile("web/sw.js")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"upload.js", "upload.css"} {
		if !strings.Contains(string(serviceWorker), expected) {
			t.Fatalf("service worker shell cache is missing %q", expected)
		}
	}
}
