package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	uploadTempDirName         = "nas-photo-upload-temp"
	uploadDestinationDirName  = "nas-photo-uploaded"
	uploadManifestName        = "manifest.json"
	uploadBatchTTL            = time.Hour
	uploadCleanupInterval     = 10 * time.Minute
	uploadCreateBodyLimit     = 4 << 20
	uploadMaximumBatchFiles   = 5000
	uploadMaximumSourceLength = 2048
)

const (
	uploadStateUploading    = "uploading"
	uploadStateReady        = "ready"
	uploadStateCommitting   = "committing"
	uploadStateCommitFailed = "commit_failed"
	uploadStateCompleted    = "completed"
)

type uploadFile struct {
	Index      int    `json:"index"`
	Name       string `json:"name"`
	SourcePath string `json:"sourcePath"`
	Size       int64  `json:"size"`
	Uploaded   bool   `json:"uploaded"`
	TargetName string `json:"targetName,omitempty"`
}

type uploadBatch struct {
	ID             string       `json:"id"`
	State          string       `json:"state"`
	CreatedAt      time.Time    `json:"createdAt"`
	LastActivityAt time.Time    `json:"lastActivityAt"`
	DateFolder     string       `json:"dateFolder"`
	RootPath       string       `json:"rootPath"`
	RootName       string       `json:"rootName"`
	Files          []uploadFile `json:"files"`
	Error          string       `json:"error,omitempty"`
}

type uploadFileView struct {
	Index      int    `json:"index"`
	Name       string `json:"name"`
	SourcePath string `json:"sourcePath"`
	Size       int64  `json:"size"`
	Uploaded   bool   `json:"uploaded"`
	TargetName string `json:"targetName,omitempty"`
}

type uploadBatchView struct {
	ID             string           `json:"id"`
	State          string           `json:"state"`
	CreatedAt      time.Time        `json:"createdAt"`
	LastActivityAt time.Time        `json:"lastActivityAt"`
	ExpiresAt      time.Time        `json:"expiresAt"`
	DateFolder     string           `json:"dateFolder"`
	RootName       string           `json:"rootName"`
	Destination    string           `json:"destination"`
	Files          []uploadFileView `json:"files"`
	Error          string           `json:"error,omitempty"`
}

type uploadCreateRequest struct {
	Files []struct {
		Name       string `json:"name"`
		SourcePath string `json:"sourcePath"`
		Size       int64  `json:"size"`
	} `json:"files"`
}

var (
	uploadTempRootOnce sync.Once
	uploadTempRootPath string
	uploadTempRootErr  error
	uploadCleanupOnce  sync.Once
	uploadBatchLocks   sync.Map
)

func (a *app) uploadRoutes(m *http.ServeMux) {
	m.HandleFunc("/api/uploads/batches", a.uploadBatches)
	m.HandleFunc("/api/uploads/batches/", a.uploadBatchByID)
	uploadCleanupOnce.Do(func() {
		if _, err := uploadTempRoot(); err != nil {
			a.log.Error("could not initialize upload temp directory", "error", err)
			return
		}
		a.cleanupExpiredUploads()
		go a.uploadCleanupLoop()
	})
}

func uploadTempRoot() (string, error) {
	uploadTempRootOnce.Do(func() {
		executable, err := os.Executable()
		if err != nil {
			uploadTempRootErr = err
			return
		}
		if resolved, err := filepath.EvalSymlinks(executable); err == nil {
			executable = resolved
		}
		uploadTempRootPath = filepath.Join(filepath.Dir(executable), uploadTempDirName)
		uploadTempRootErr = os.MkdirAll(uploadTempRootPath, 0700)
	})
	return uploadTempRootPath, uploadTempRootErr
}

func (a *app) uploadBatches(w http.ResponseWriter, r *http.Request) {
	if !a.authed(w, r) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.listUploadBatches(w)
	case http.MethodPost:
		a.createUploadBatch(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *app) uploadBatchByID(w http.ResponseWriter, r *http.Request) {
	if !a.authed(w, r) {
		return
	}
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/uploads/batches/"), "/")
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || !validUploadBatchID(parts[0]) {
		http.NotFound(w, r)
		return
	}
	batchID := parts[0]
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			a.getUploadBatch(w, batchID)
		case http.MethodDelete:
			a.deleteUploadBatch(w, batchID)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}
	if len(parts) == 2 && parts[1] == "commit" {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		a.commitUploadBatch(w, batchID)
		return
	}
	if len(parts) == 3 && parts[1] == "files" {
		if r.Method != http.MethodPut {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		index, err := strconv.Atoi(parts[2])
		if err != nil || index < 0 {
			http.Error(w, "invalid file index", http.StatusBadRequest)
			return
		}
		a.receiveUploadFile(w, r, batchID, index)
		return
	}
	http.NotFound(w, r)
}

func (a *app) createUploadBatch(w http.ResponseWriter, r *http.Request) {
	var request uploadCreateRequest
	r.Body = http.MaxBytesReader(w, r.Body, uploadCreateBodyLimit)
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "invalid upload manifest", http.StatusBadRequest)
		return
	}
	if len(request.Files) == 0 {
		http.Error(w, "no supported media files", http.StatusBadRequest)
		return
	}
	if len(request.Files) > uploadMaximumBatchFiles {
		http.Error(w, "too many files in one upload", http.StatusRequestEntityTooLarge)
		return
	}

	a.st.mu.RLock()
	if len(a.st.Roots) == 0 {
		a.st.mu.RUnlock()
		http.Error(w, "no media folder configured", http.StatusConflict)
		return
	}
	root := a.st.Roots[0]
	a.st.mu.RUnlock()

	files := make([]uploadFile, 0, len(request.Files))
	for i, file := range request.Files {
		name, err := safeUploadName(file.Name)
		if err != nil || kind(name) == "" || file.Size <= 0 {
			http.Error(w, "unsupported upload file", http.StatusBadRequest)
			return
		}
		files = append(files, uploadFile{
			Index: i, Name: name, SourcePath: cleanUploadSourcePath(file.SourcePath, name), Size: file.Size,
		})
	}

	if existing, ok := a.findMatchingUploadBatch(root.Path, files); ok {
		jsonOut(w, map[string]any{"batch": uploadBatchResponse(existing), "reused": true})
		return
	}

	now := time.Now()
	batch := &uploadBatch{
		ID: id(), State: uploadStateUploading, CreatedAt: now, LastActivityAt: now,
		DateFolder: now.Format("20060102"), RootPath: root.Path, RootName: root.Name, Files: files,
	}
	lock := uploadBatchLock(batch.ID)
	lock.Lock()
	err := saveUploadBatch(batch)
	lock.Unlock()
	if err != nil {
		http.Error(w, "could not create upload batch", http.StatusInternalServerError)
		return
	}
	jsonOut(w, map[string]any{"batch": uploadBatchResponse(batch), "reused": false})
}

func (a *app) listUploadBatches(w http.ResponseWriter) {
	a.cleanupExpiredUploads()
	root, err := uploadTempRoot()
	if err != nil {
		http.Error(w, "upload temp directory is unavailable", http.StatusInternalServerError)
		return
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		http.Error(w, "could not read upload batches", http.StatusInternalServerError)
		return
	}
	views := make([]uploadBatchView, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || !validUploadBatchID(entry.Name()) {
			continue
		}
		lock := uploadBatchLock(entry.Name())
		lock.Lock()
		batch, err := loadUploadBatch(entry.Name())
		if err == nil && !uploadBatchExpired(batch, time.Now()) {
			views = append(views, uploadBatchResponse(batch))
		}
		lock.Unlock()
	}
	sort.Slice(views, func(i, j int) bool { return views[i].CreatedAt.After(views[j].CreatedAt) })
	jsonOut(w, map[string]any{"batches": views})
}

func (a *app) getUploadBatch(w http.ResponseWriter, batchID string) {
	lock := uploadBatchLock(batchID)
	lock.Lock()
	defer lock.Unlock()
	batch, err := loadUploadBatch(batchID)
	if err != nil {
		http.Error(w, "upload batch not found", http.StatusNotFound)
		return
	}
	if uploadBatchExpired(batch, time.Now()) {
		a.removeUploadBatch(batch)
		http.Error(w, "upload batch expired", http.StatusGone)
		return
	}
	jsonOut(w, map[string]any{"batch": uploadBatchResponse(batch)})
}

func (a *app) receiveUploadFile(w http.ResponseWriter, r *http.Request, batchID string, index int) {
	lock := uploadBatchLock(batchID)
	lock.Lock()
	defer lock.Unlock()

	batch, err := loadUploadBatch(batchID)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if uploadBatchExpired(batch, time.Now()) {
		a.removeUploadBatch(batch)
		http.Error(w, "upload batch expired", http.StatusGone)
		return
	}
	if index >= len(batch.Files) || batch.Files[index].Index != index {
		http.Error(w, "invalid file index", http.StatusBadRequest)
		return
	}
	if batch.State == uploadStateCommitting || batch.State == uploadStateCompleted {
		http.Error(w, "upload batch is not writable", http.StatusConflict)
		return
	}

	file := &batch.Files[index]
	partPath, receivingPath, err := uploadPartPaths(batch.ID, index)
	if err != nil {
		http.Error(w, "upload temp directory is unavailable", http.StatusInternalServerError)
		return
	}
	if file.Uploaded {
		if info, err := os.Stat(partPath); err == nil && info.Size() == file.Size {
			batch.LastActivityAt = time.Now()
			batch.Error = ""
			_ = saveUploadBatch(batch)
			jsonOut(w, map[string]any{"batch": uploadBatchResponse(batch), "alreadyUploaded": true})
			return
		}
		file.Uploaded = false
	}

	batch.State = uploadStateUploading
	batch.LastActivityAt = time.Now()
	batch.Error = ""
	if err := saveUploadBatch(batch); err != nil {
		http.Error(w, "could not update upload batch", http.StatusInternalServerError)
		return
	}
	_ = os.Remove(receivingPath)
	out, err := os.OpenFile(receivingPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		http.Error(w, "could not create upload temp file", http.StatusInternalServerError)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, file.Size)
	written, copyErr := io.Copy(out, r.Body)
	syncErr := out.Sync()
	closeErr := out.Close()
	if copyErr != nil || syncErr != nil || closeErr != nil || written != file.Size {
		_ = os.Remove(receivingPath)
		batch.LastActivityAt = time.Now()
		batch.Error = "file upload was interrupted"
		_ = saveUploadBatch(batch)
		http.Error(w, "file upload was interrupted", http.StatusBadRequest)
		return
	}
	_ = os.Remove(partPath)
	if err := os.Rename(receivingPath, partPath); err != nil {
		_ = os.Remove(receivingPath)
		batch.LastActivityAt = time.Now()
		batch.Error = err.Error()
		_ = saveUploadBatch(batch)
		http.Error(w, "could not finalize upload temp file", http.StatusInternalServerError)
		return
	}
	file.Uploaded = true
	batch.LastActivityAt = time.Now()
	batch.Error = ""
	if allUploadFilesReceived(batch) {
		batch.State = uploadStateReady
	}
	if err := saveUploadBatch(batch); err != nil {
		http.Error(w, "could not update upload batch", http.StatusInternalServerError)
		return
	}
	jsonOut(w, map[string]any{"batch": uploadBatchResponse(batch), "alreadyUploaded": false})
}

func (a *app) commitUploadBatch(w http.ResponseWriter, batchID string) {
	lock := uploadBatchLock(batchID)
	lock.Lock()
	defer lock.Unlock()

	batch, err := loadUploadBatch(batchID)
	if err != nil {
		http.Error(w, "upload batch not found", http.StatusNotFound)
		return
	}
	if uploadBatchExpired(batch, time.Now()) {
		a.removeUploadBatch(batch)
		http.Error(w, "upload batch expired", http.StatusGone)
		return
	}
	if !allUploadFilesReceived(batch) {
		http.Error(w, "upload batch is incomplete", http.StatusConflict)
		return
	}
	if !a.uploadRootStillConfigured(batch.RootPath) {
		batch.State = uploadStateCommitFailed
		batch.LastActivityAt = time.Now()
		batch.Error = "upload destination is no longer configured"
		_ = saveUploadBatch(batch)
		http.Error(w, batch.Error, http.StatusConflict)
		return
	}
	for i := range batch.Files {
		partPath, _, pathErr := uploadPartPaths(batch.ID, i)
		if pathErr != nil {
			http.Error(w, "upload temp directory is unavailable", http.StatusInternalServerError)
			return
		}
		info, statErr := os.Stat(partPath)
		if statErr != nil || info.Size() != batch.Files[i].Size {
			batch.Files[i].Uploaded = false
			batch.State = uploadStateUploading
			batch.LastActivityAt = time.Now()
			batch.Error = "an uploaded file is missing or incomplete"
			_ = saveUploadBatch(batch)
			http.Error(w, batch.Error, http.StatusConflict)
			return
		}
	}

	batch.State = uploadStateCommitting
	batch.LastActivityAt = time.Now()
	batch.Error = ""
	if err := saveUploadBatch(batch); err != nil {
		http.Error(w, "could not update upload batch", http.StatusInternalServerError)
		return
	}

	destinationDir := filepath.Join(batch.RootPath, uploadDestinationDirName, batch.DateFolder)
	if err := os.MkdirAll(destinationDir, 0755); err != nil {
		a.failUploadCommit(batch, err)
		http.Error(w, "could not create upload destination", http.StatusInternalServerError)
		return
	}
	if err := planUploadTargetNames(destinationDir, batch); err != nil {
		a.failUploadCommit(batch, err)
		http.Error(w, "could not plan upload destination names", http.StatusInternalServerError)
		return
	}
	if err := saveUploadBatch(batch); err != nil {
		a.failUploadCommit(batch, err)
		http.Error(w, "could not save upload commit plan", http.StatusInternalServerError)
		return
	}

	staged := make(map[int]string)
	for i := range batch.Files {
		file := &batch.Files[i]
		finalPath := filepath.Join(destinationDir, file.TargetName)
		if info, err := os.Stat(finalPath); err == nil && info.Size() == file.Size {
			continue
		}
		partPath, _, _ := uploadPartPaths(batch.ID, i)
		stagePath := uploadNASStagePath(destinationDir, batch.ID, i)
		_ = os.Remove(stagePath)
		if err := copyUploadFile(partPath, stagePath, file.Size); err != nil {
			removeUploadStages(staged)
			_ = os.Remove(stagePath)
			a.failUploadCommit(batch, err)
			http.Error(w, "could not copy upload to media folder", http.StatusInternalServerError)
			return
		}
		staged[i] = stagePath
	}

	for i := range batch.Files {
		stagePath, ok := staged[i]
		if !ok {
			continue
		}
		finalPath := filepath.Join(destinationDir, batch.Files[i].TargetName)
		if info, err := os.Stat(finalPath); err == nil {
			if info.Size() == batch.Files[i].Size {
				_ = os.Remove(stagePath)
				delete(staged, i)
				continue
			}
			removeUploadStages(staged)
			err := fmt.Errorf("destination appeared during commit: %s", batch.Files[i].TargetName)
			a.failUploadCommit(batch, err)
			http.Error(w, "upload destination changed during commit", http.StatusConflict)
			return
		}
		if err := os.Rename(stagePath, finalPath); err != nil {
			removeUploadStages(staged)
			a.failUploadCommit(batch, err)
			http.Error(w, "could not finalize uploaded media", http.StatusInternalServerError)
			return
		}
		delete(staged, i)
	}

	batch.State = uploadStateCompleted
	batch.LastActivityAt = time.Now()
	batch.Error = ""
	view := uploadBatchResponse(batch)
	_ = saveUploadBatch(batch)
	a.scheduleUploadRescan()
	if err := os.RemoveAll(uploadBatchDir(batch.ID)); err != nil {
		a.log.Warn("could not remove completed upload batch", "batch", batch.ID, "error", err)
	}
	uploadBatchLocks.Delete(batch.ID)
	jsonOut(w, map[string]any{"ok": true, "batch": view})
}

func (a *app) deleteUploadBatch(w http.ResponseWriter, batchID string) {
	lock := uploadBatchLock(batchID)
	lock.Lock()
	defer lock.Unlock()
	batch, err := loadUploadBatch(batchID)
	if err != nil {
		http.Error(w, "upload batch not found", http.StatusNotFound)
		return
	}
	a.removeUploadBatch(batch)
	uploadBatchLocks.Delete(batchID)
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) failUploadCommit(batch *uploadBatch, err error) {
	batch.State = uploadStateCommitFailed
	batch.LastActivityAt = time.Now()
	batch.Error = err.Error()
	_ = saveUploadBatch(batch)
}

func (a *app) uploadRootStillConfigured(path string) bool {
	a.st.mu.RLock()
	defer a.st.mu.RUnlock()
	for _, root := range a.st.Roots {
		if root.Path == path {
			return true
		}
	}
	return false
}

func (a *app) findMatchingUploadBatch(rootPath string, files []uploadFile) (*uploadBatch, bool) {
	a.cleanupExpiredUploads()
	root, err := uploadTempRoot()
	if err != nil {
		return nil, false
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, false
	}
	for _, entry := range entries {
		if !entry.IsDir() || !validUploadBatchID(entry.Name()) {
			continue
		}
		lock := uploadBatchLock(entry.Name())
		lock.Lock()
		batch, err := loadUploadBatch(entry.Name())
		match := err == nil && !uploadBatchExpired(batch, time.Now()) && batch.RootPath == rootPath && sameUploadFiles(batch.Files, files)
		if match {
			batch.LastActivityAt = time.Now()
			batch.Error = ""
			_ = saveUploadBatch(batch)
		}
		lock.Unlock()
		if match {
			return batch, true
		}
	}
	return nil, false
}

func sameUploadFiles(left, right []uploadFile) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i].Name != right[i].Name || left[i].SourcePath != right[i].SourcePath || left[i].Size != right[i].Size {
			return false
		}
	}
	return true
}

func safeUploadName(value string) (string, error) {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	name := filepath.Base(value)
	if name == "" || name == "." || name == ".." || strings.ContainsRune(name, '\x00') {
		return "", errors.New("invalid file name")
	}
	if len([]byte(name)) > 240 {
		return "", errors.New("file name is too long")
	}
	return name, nil
}

func cleanUploadSourcePath(value, fallback string) string {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	value = strings.TrimLeft(value, "/")
	value = strings.ReplaceAll(value, "\x00", "")
	if value == "" {
		value = fallback
	}
	runes := []rune(value)
	if len(runes) > uploadMaximumSourceLength {
		value = string(runes[len(runes)-uploadMaximumSourceLength:])
	}
	return value
}

func validUploadBatchID(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func uploadBatchLock(batchID string) *sync.Mutex {
	lock, _ := uploadBatchLocks.LoadOrStore(batchID, &sync.Mutex{})
	return lock.(*sync.Mutex)
}

func uploadBatchDir(batchID string) string {
	root, _ := uploadTempRoot()
	return filepath.Join(root, batchID)
}

func uploadPartPaths(batchID string, index int) (string, string, error) {
	root, err := uploadTempRoot()
	if err != nil {
		return "", "", err
	}
	dir := filepath.Join(root, batchID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", "", err
	}
	base := fmt.Sprintf("%06d", index)
	return filepath.Join(dir, base+".part"), filepath.Join(dir, base+".receiving"), nil
}

func saveUploadBatch(batch *uploadBatch) error {
	root, err := uploadTempRoot()
	if err != nil {
		return err
	}
	dir := filepath.Join(root, batch.ID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	content, err := json.MarshalIndent(batch, "", "  ")
	if err != nil {
		return err
	}
	target := filepath.Join(dir, uploadManifestName)
	temp := target + ".tmp"
	if err := os.WriteFile(temp, content, 0600); err != nil {
		return err
	}
	return os.Rename(temp, target)
}

func loadUploadBatch(batchID string) (*uploadBatch, error) {
	if !validUploadBatchID(batchID) {
		return nil, os.ErrNotExist
	}
	root, err := uploadTempRoot()
	if err != nil {
		return nil, err
	}
	content, err := os.ReadFile(filepath.Join(root, batchID, uploadManifestName))
	if err != nil {
		return nil, err
	}
	var batch uploadBatch
	if err := json.Unmarshal(content, &batch); err != nil {
		return nil, err
	}
	if batch.ID != batchID {
		return nil, errors.New("upload batch id mismatch")
	}
	return &batch, nil
}

func uploadBatchResponse(batch *uploadBatch) uploadBatchView {
	files := make([]uploadFileView, len(batch.Files))
	for i, file := range batch.Files {
		files[i] = uploadFileView{
			Index: file.Index, Name: file.Name, SourcePath: file.SourcePath, Size: file.Size,
			Uploaded: file.Uploaded, TargetName: file.TargetName,
		}
	}
	return uploadBatchView{
		ID: batch.ID, State: batch.State, CreatedAt: batch.CreatedAt, LastActivityAt: batch.LastActivityAt,
		ExpiresAt: batch.LastActivityAt.Add(uploadBatchTTL), DateFolder: batch.DateFolder, RootName: batch.RootName,
		Destination: filepath.ToSlash(filepath.Join(uploadDestinationDirName, batch.DateFolder)), Files: files, Error: batch.Error,
	}
}

func uploadBatchExpired(batch *uploadBatch, now time.Time) bool {
	return !batch.LastActivityAt.IsZero() && !now.Before(batch.LastActivityAt.Add(uploadBatchTTL))
}

func allUploadFilesReceived(batch *uploadBatch) bool {
	if len(batch.Files) == 0 {
		return false
	}
	for _, file := range batch.Files {
		if !file.Uploaded {
			return false
		}
	}
	return true
}

func planUploadTargetNames(destinationDir string, batch *uploadBatch) error {
	reserved := map[string]bool{}
	for i := range batch.Files {
		file := &batch.Files[i]
		if file.TargetName != "" {
			finalPath := filepath.Join(destinationDir, file.TargetName)
			if info, err := os.Stat(finalPath); err == nil {
				if info.Size() == file.Size {
					reserved[uploadNameKey(file.TargetName)] = true
					continue
				}
				file.TargetName = ""
			} else if !errors.Is(err, os.ErrNotExist) {
				return err
			} else {
				reserved[uploadNameKey(file.TargetName)] = true
				continue
			}
		}
		name, err := nextUploadTargetName(destinationDir, file.Name, reserved)
		if err != nil {
			return err
		}
		file.TargetName = name
		reserved[uploadNameKey(name)] = true
	}
	return nil
}

func nextUploadTargetName(destinationDir, original string, reserved map[string]bool) (string, error) {
	ext := filepath.Ext(original)
	base := strings.TrimSuffix(original, ext)
	if base == "" {
		base = "media"
	}
	for number := 1; number < 1000000; number++ {
		candidate := original
		if number > 1 {
			candidate = fmt.Sprintf("%s_%d%s", base, number, ext)
		}
		if reserved[uploadNameKey(candidate)] {
			continue
		}
		_, err := os.Stat(filepath.Join(destinationDir, candidate))
		if errors.Is(err, os.ErrNotExist) {
			return candidate, nil
		}
		if err != nil {
			return "", err
		}
	}
	return "", errors.New("could not allocate a unique upload file name")
}

func uploadNameKey(name string) string {
	if runtime.GOOS == "windows" {
		return strings.ToLower(name)
	}
	return name
}

func uploadNASStagePath(destinationDir, batchID string, index int) string {
	return filepath.Join(destinationDir, fmt.Sprintf(".nas-photo-%s-%06d.nas-photo-part", batchID, index))
}

func copyUploadFile(source, destination string, expectedSize int64) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	written, copyErr := io.Copy(out, in)
	syncErr := out.Sync()
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if syncErr != nil {
		return syncErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written != expectedSize {
		return fmt.Errorf("copied %d bytes, expected %d", written, expectedSize)
	}
	return nil
}

func removeUploadStages(staged map[int]string) {
	for _, path := range staged {
		_ = os.Remove(path)
	}
}

func (a *app) removeUploadBatch(batch *uploadBatch) {
	a.cleanupUploadNASStages(batch)
	_ = os.RemoveAll(uploadBatchDir(batch.ID))
}

func (a *app) cleanupUploadNASStages(batch *uploadBatch) {
	if batch.RootPath == "" || batch.DateFolder == "" || !validUploadBatchID(batch.ID) {
		return
	}
	destinationDir := filepath.Join(batch.RootPath, uploadDestinationDirName, batch.DateFolder)
	matches, _ := filepath.Glob(filepath.Join(destinationDir, ".nas-photo-"+batch.ID+"-*.nas-photo-part"))
	for _, match := range matches {
		_ = os.Remove(match)
	}
}

func (a *app) cleanupExpiredUploads() {
	root, err := uploadTempRoot()
	if err != nil {
		return
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	now := time.Now()
	for _, entry := range entries {
		if !entry.IsDir() || !validUploadBatchID(entry.Name()) {
			continue
		}
		batchID := entry.Name()
		lock := uploadBatchLock(batchID)
		lock.Lock()
		batch, loadErr := loadUploadBatch(batchID)
		if loadErr == nil {
			if uploadBatchExpired(batch, now) {
				a.removeUploadBatch(batch)
				uploadBatchLocks.Delete(batchID)
			}
			lock.Unlock()
			continue
		}
		if info, statErr := entry.Info(); statErr == nil && now.Sub(info.ModTime()) >= uploadBatchTTL {
			_ = os.RemoveAll(filepath.Join(root, batchID))
			uploadBatchLocks.Delete(batchID)
		}
		lock.Unlock()
	}
}

func (a *app) uploadCleanupLoop() {
	ticker := time.NewTicker(uploadCleanupInterval)
	defer ticker.Stop()
	for range ticker.C {
		a.cleanupExpiredUploads()
	}
}

func (a *app) scheduleUploadRescan() {
	go func() {
		for {
			if a.beginScan() {
				a.runScan(context.Background())
				return
			}
			time.Sleep(time.Second)
		}
	}()
}
