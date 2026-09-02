package main

import (
	"bytes"
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

type uploadCommitProgressView struct {
	Active     bool  `json:"active"`
	DoneBytes  int64 `json:"doneBytes"`
	TotalBytes int64 `json:"totalBytes"`
}

type uploadCreateRequest struct {
	Files []struct {
		Name       string `json:"name"`
		SourcePath string `json:"sourcePath"`
		Size       int64  `json:"size"`
	} `json:"files"`
}

var (
	uploadTempRootOnce      sync.Once
	uploadTempRootPath      string
	uploadTempRootErr       error
	uploadTempRootTest      string
	uploadCleanupOnce       sync.Once
	uploadBatchLocks        sync.Map
	uploadCommitProgressMu  sync.RWMutex
	uploadCommitProgressMap = map[string]uploadCommitProgressView{}
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
	if uploadTempRootTest != "" {
		return uploadTempRootTest, os.MkdirAll(uploadTempRootTest, 0700)
	}
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
	if len(parts) == 2 && parts[1] == "progress" {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		a.getUploadCommitProgress(w, batchID)
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
	if !a.uploadRootStillConfigured(root.Path) {
		http.Error(w, "upload destination is not allowed", http.StatusConflict)
		return
	}

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

func uploadTotalBytes(batch *uploadBatch) int64 {
	var total int64
	for _, file := range batch.Files {
		total += file.Size
	}
	return total
}

func setUploadCommitProgress(batchID string, done, total int64, active bool) {
	if done < 0 {
		done = 0
	}
	if total < 0 {
		total = 0
	}
	if total > 0 && done > total {
		done = total
	}
	uploadCommitProgressMu.Lock()
	uploadCommitProgressMap[batchID] = uploadCommitProgressView{Active: active, DoneBytes: done, TotalBytes: total}
	uploadCommitProgressMu.Unlock()
}

func clearUploadCommitProgress(batchID string) {
	uploadCommitProgressMu.Lock()
	delete(uploadCommitProgressMap, batchID)
	uploadCommitProgressMu.Unlock()
}

func (a *app) getUploadCommitProgress(w http.ResponseWriter, batchID string) {
	uploadCommitProgressMu.RLock()
	progress, ok := uploadCommitProgressMap[batchID]
	uploadCommitProgressMu.RUnlock()
	if !ok {
		progress = uploadCommitProgressView{}
	}
	jsonOut(w, map[string]any{"progress": progress})
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

	commitTotal := uploadTotalBytes(batch)
	commitDone := int64(0)
	setUploadCommitProgress(batch.ID, 0, commitTotal, true)
	defer clearUploadCommitProgress(batch.ID)

	destinationDir, err := uploadDestinationPath(batch.RootPath, batch.DateFolder, true)
	if err != nil {
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
		partPath, _, _ := uploadPartPaths(batch.ID, i)
		if _, statErr := os.Stat(finalPath); statErr == nil {
			equal, compareErr := uploadFilesEqual(partPath, finalPath, file.Size)
			if compareErr != nil {
				a.failUploadCommit(batch, compareErr)
				http.Error(w, "could not verify uploaded media", http.StatusInternalServerError)
				return
			}
			if equal {
				commitDone += file.Size
				setUploadCommitProgress(batch.ID, commitDone, commitTotal, true)
				continue
			}
		}
		stagePath := uploadNASStagePath(destinationDir, batch.ID, i)
		_ = os.Remove(stagePath)
		baseDone := commitDone
		if err := copyUploadFile(partPath, stagePath, file.Size, func(fileDone int64) {
			setUploadCommitProgress(batch.ID, baseDone+fileDone, commitTotal, true)
		}); err != nil {
			removeUploadStages(staged)
			_ = os.Remove(stagePath)
			a.failUploadCommit(batch, err)
			http.Error(w, "could not copy upload to media folder", http.StatusInternalServerError)
			return
		}
		commitDone += file.Size
		setUploadCommitProgress(batch.ID, commitDone, commitTotal, true)
		staged[i] = stagePath
	}

	for i := range batch.Files {
		stagePath, ok := staged[i]
		if !ok {
			continue
		}
		finalPath := filepath.Join(destinationDir, batch.Files[i].TargetName)
		if _, err := os.Stat(finalPath); err == nil {
			partPath, _, _ := uploadPartPaths(batch.ID, i)
			equal, compareErr := uploadFilesEqual(partPath, finalPath, batch.Files[i].Size)
			if compareErr == nil && equal {
				_ = os.Remove(stagePath)
				delete(staged, i)
				continue
			}
			removeUploadStages(staged)
			if compareErr != nil {
				a.failUploadCommit(batch, compareErr)
				http.Error(w, "could not verify upload destination", http.StatusInternalServerError)
				return
			}
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
	setUploadCommitProgress(batch.ID, commitTotal, commitTotal, true)
	view := uploadBatchResponse(batch)
	_ = saveUploadBatch(batch)
	a.scheduleUploadRescan()
	if err := os.RemoveAll(uploadBatchDir(batch.ID)); err != nil {
		a.log.Warn("could not remove completed upload batch", "batch", batch.ID, "error", err)
	}
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
	configured := false
	for _, root := range a.st.Roots {
		if root.Path == path {
			configured = true
			break
		}
	}
	a.st.mu.RUnlock()
	if !configured || !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return false
	}
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return false
	}
	info, err := os.Stat(resolvedPath)
	if err != nil || !info.IsDir() {
		return false
	}
	for _, allowed := range a.allowed {
		resolvedAllowed, err := filepath.EvalSymlinks(allowed)
		if err == nil && pathWithin(resolvedAllowed, resolvedPath) {
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
		match := err == nil && batch.State != uploadStateCompleted && !uploadBatchExpired(batch, time.Now()) && batch.RootPath == rootPath && sameUploadFiles(batch.Files, files)
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
	if !validUploadBatchID(batchID) || index < 0 || index >= uploadMaximumBatchFiles {
		return "", "", errors.New("invalid upload part path")
	}
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
	if err := validateUploadBatch(batch, batch.ID); err != nil {
		return err
	}
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
	if err := validateUploadBatch(&batch, batchID); err != nil {
		return nil, err
	}
	return &batch, nil
}

func validateUploadBatch(batch *uploadBatch, expectedID string) error {
	if batch == nil || !validUploadBatchID(expectedID) || batch.ID != expectedID {
		return errors.New("invalid upload batch id")
	}
	switch batch.State {
	case uploadStateUploading, uploadStateReady, uploadStateCommitting, uploadStateCommitFailed, uploadStateCompleted:
	default:
		return errors.New("invalid upload batch state")
	}
	if batch.CreatedAt.IsZero() || batch.LastActivityAt.IsZero() {
		return errors.New("invalid upload batch timestamps")
	}
	if _, err := time.Parse("20060102", batch.DateFolder); err != nil || len(batch.DateFolder) != 8 {
		return errors.New("invalid upload date folder")
	}
	if batch.DateFolder != batch.CreatedAt.Format("20060102") {
		return errors.New("upload date folder does not match batch creation date")
	}
	if !filepath.IsAbs(batch.RootPath) || filepath.Clean(batch.RootPath) != batch.RootPath {
		return errors.New("invalid upload root path")
	}
	if len(batch.Files) == 0 || len(batch.Files) > uploadMaximumBatchFiles {
		return errors.New("invalid upload file count")
	}
	for i := range batch.Files {
		file := &batch.Files[i]
		name, err := safeUploadName(file.Name)
		if err != nil || name != file.Name || kind(file.Name) == "" || file.Size <= 0 || file.Index != i {
			return errors.New("invalid upload file manifest")
		}
		if cleanUploadSourcePath(file.SourcePath, file.Name) != file.SourcePath {
			return errors.New("invalid upload source path")
		}
		if file.TargetName != "" {
			target, err := safeUploadName(file.TargetName)
			if err != nil || target != file.TargetName {
				return errors.New("invalid upload target name")
			}
		}
	}
	return nil
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
			if _, err := os.Stat(finalPath); err == nil {
				partPath, _, pathErr := uploadPartPaths(batch.ID, i)
				if pathErr != nil {
					return pathErr
				}
				equal, compareErr := uploadFilesEqual(partPath, finalPath, file.Size)
				if compareErr != nil {
					return compareErr
				}
				if equal {
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

type uploadProgressWriter struct {
	dst          io.Writer
	written      int64
	lastReported int64
	onProgress   func(int64)
}

func (w *uploadProgressWriter) Write(p []byte) (int, error) {
	n, err := w.dst.Write(p)
	w.written += int64(n)
	if w.onProgress != nil && (w.written-w.lastReported >= 1<<20 || err != nil) {
		w.lastReported = w.written
		w.onProgress(w.written)
	}
	return n, err
}

func copyUploadFile(source, destination string, expectedSize int64, onProgress func(int64)) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	progressOut := &uploadProgressWriter{dst: out, onProgress: onProgress}
	written, copyErr := io.Copy(progressOut, in)
	if onProgress != nil {
		onProgress(written)
	}
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

func uploadFilesEqual(leftPath, rightPath string, expectedSize int64) (bool, error) {
	left, err := os.Open(leftPath)
	if err != nil {
		return false, err
	}
	defer left.Close()
	right, err := os.Open(rightPath)
	if err != nil {
		return false, err
	}
	defer right.Close()
	leftInfo, err := left.Stat()
	if err != nil {
		return false, err
	}
	rightInfo, err := right.Stat()
	if err != nil {
		return false, err
	}
	if leftInfo.Size() != expectedSize || rightInfo.Size() != expectedSize {
		return false, nil
	}
	leftBuffer := make([]byte, 64*1024)
	rightBuffer := make([]byte, len(leftBuffer))
	for {
		leftN, leftErr := left.Read(leftBuffer)
		rightN, rightErr := right.Read(rightBuffer)
		if leftN != rightN || !bytes.Equal(leftBuffer[:leftN], rightBuffer[:rightN]) {
			return false, nil
		}
		if leftErr != nil || rightErr != nil {
			if errors.Is(leftErr, io.EOF) && errors.Is(rightErr, io.EOF) {
				return true, nil
			}
			if leftErr != nil && !errors.Is(leftErr, io.EOF) {
				return false, leftErr
			}
			if rightErr != nil && !errors.Is(rightErr, io.EOF) {
				return false, rightErr
			}
			return false, nil
		}
	}
}

func uploadDestinationPath(rootPath, dateFolder string, create bool) (string, error) {
	if !filepath.IsAbs(rootPath) || filepath.Clean(rootPath) != rootPath {
		return "", errors.New("invalid upload root path")
	}
	if _, err := time.Parse("20060102", dateFolder); err != nil || len(dateFolder) != 8 {
		return "", errors.New("invalid upload date folder")
	}
	rootResolved, err := filepath.EvalSymlinks(rootPath)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(rootResolved)
	if err != nil || !info.IsDir() {
		return "", errors.New("upload root is not a directory")
	}
	base := filepath.Join(rootPath, uploadDestinationDirName)
	if err := ensureUploadDirectory(base, create); err != nil {
		return "", err
	}
	baseResolved, err := filepath.EvalSymlinks(base)
	if err != nil || !pathWithin(rootResolved, baseResolved) {
		return "", errors.New("upload destination escapes configured root")
	}
	destination := filepath.Join(base, dateFolder)
	if err := ensureUploadDirectory(destination, create); err != nil {
		return "", err
	}
	destinationResolved, err := filepath.EvalSymlinks(destination)
	if err != nil || !pathWithin(rootResolved, destinationResolved) {
		return "", errors.New("upload destination escapes configured root")
	}
	return destination, nil
}

func ensureUploadDirectory(path string, create bool) error {
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) && create {
		if err := os.Mkdir(path, 0755); err != nil && !errors.Is(err, os.ErrExist) {
			return err
		}
		info, err = os.Stat(path)
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("upload destination is not a directory")
	}
	return nil
}

func pathWithin(root, candidate string) bool {
	rel, err := filepath.Rel(root, candidate)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func removeUploadStages(staged map[int]string) {
	for _, path := range staged {
		_ = os.Remove(path)
	}
}

func (a *app) removeUploadBatch(batch *uploadBatch) {
	a.cleanupUploadNASStages(batch)
	clearUploadCommitProgress(batch.ID)
	_ = os.RemoveAll(uploadBatchDir(batch.ID))
}

func (a *app) cleanupUploadNASStages(batch *uploadBatch) {
	if batch.RootPath == "" || batch.DateFolder == "" || !validUploadBatchID(batch.ID) {
		return
	}
	destinationDir, err := uploadDestinationPath(batch.RootPath, batch.DateFolder, false)
	if err != nil {
		return
	}
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
			}
			lock.Unlock()
			continue
		}
		if info, statErr := entry.Info(); statErr == nil && now.Sub(info.ModTime()) >= uploadBatchTTL {
			_ = os.RemoveAll(filepath.Join(root, batchID))
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
	a.uploadRescanMu.Lock()
	a.uploadRescanPending = true
	if a.uploadRescanRunning {
		a.uploadRescanMu.Unlock()
		return
	}
	a.uploadRescanRunning = true
	a.uploadRescanMu.Unlock()
	go func() {
		for {
			a.uploadRescanMu.Lock()
			if !a.uploadRescanPending {
				a.uploadRescanRunning = false
				a.uploadRescanMu.Unlock()
				return
			}
			a.uploadRescanPending = false
			a.uploadRescanMu.Unlock()
			if a.beginScan() {
				a.runScan(context.Background())
				continue
			}
			a.uploadRescanMu.Lock()
			a.uploadRescanPending = true
			a.uploadRescanMu.Unlock()
			time.Sleep(time.Second)
		}
	}()
}
