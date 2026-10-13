package main

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const trashDirName = "_nas-photo-trash"

func isTrashPath(path string) bool {
	for _, part := range strings.FieldsFunc(path, func(r rune) bool { return r == '/' || r == '\\' }) {
		if strings.EqualFold(part, trashDirName) {
			return true
		}
	}
	return false
}

func (a *app) withoutTrash(items []Item, pruneMissing bool) []Item {
	available := map[string]bool{}
	if pruneMissing && a.st != nil {
		a.st.mu.RLock()
		for _, root := range a.st.Roots {
			info, err := os.Stat(root.Path)
			available[root.ID] = err == nil && info.IsDir()
		}
		a.st.mu.RUnlock()
	}
	out := make([]Item, 0, len(items))
	for _, item := range items {
		if isTrashPath(item.Path) {
			continue
		}
		if pruneMissing && available[item.RootID] {
			if _, err := os.Stat(item.Path); errors.Is(err, os.ErrNotExist) {
				continue
			}
		}
		out = append(out, item)
	}
	return out
}

func (a *app) trashMedia(w http.ResponseWriter, r *http.Request, itemID string) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := a.moveMediaToTrash(itemID); err != nil {
		a.log.Warn("could not move media to trash", "id", itemID, "error", err)
		http.Error(w, "could not move this file to the trash", http.StatusConflict)
		return
	}
	jsonOut(w, map[string]any{"ok": true, "id": itemID})
}

func (a *app) moveMediaToTrash(itemID string) error {
	a.libraryMu.Lock()
	defer a.libraryMu.Unlock()
	a.scanMu.Lock()
	var item Item
	found := false
	for _, candidate := range a.items {
		if candidate.ID == itemID {
			item, found = candidate, true
			break
		}
	}
	a.scanMu.Unlock()
	if !found || isTrashPath(item.Path) {
		return os.ErrNotExist
	}
	a.st.mu.RLock()
	var rootPath string
	for _, root := range a.st.Roots {
		if root.ID == item.RootID {
			rootPath = root.Path
			break
		}
	}
	a.st.mu.RUnlock()
	if rootPath == "" || !pathWithin(rootPath, item.Path) {
		return errors.New("file is outside configured media folders")
	}
	resolvedRoot, err := filepath.EvalSymlinks(rootPath)
	if err != nil || isTrashPath(resolvedRoot) {
		return errors.New("media folder is unavailable")
	}
	rel, err := filepath.Rel(rootPath, item.Path)
	if err != nil || !filepath.IsLocal(rel) || isTrashPath(rel) {
		return errors.New("invalid media path")
	}
	// Root confines every filesystem operation even if a parent is a symlink.
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return err
	}
	defer root.Close()
	info, err := root.Lstat(rel)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != item.Size || !info.ModTime().Equal(item.Modified) {
		return errors.New("file changed; scan the library again")
	}
	if info, err := root.Lstat(trashDirName); err == nil && !info.IsDir() {
		return errors.New("trash path is not a regular directory")
	}
	if err := root.MkdirAll(trashDirName, 0755); err != nil {
		return err
	}
	// An exclusive operation directory prevents Rename from replacing a file.
	entry := filepath.Join(trashDirName, time.Now().Format("20060102-150405")+"-"+id())
	if err := root.Mkdir(entry, 0755); err != nil {
		return err
	}
	target := filepath.Join(entry, rel)
	if err := root.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	if err := root.Rename(rel, target); err != nil {
		// No copy-and-delete fallback: failed moves leave the original intact.
		return err
	}
	if a.db != nil {
		tx, dbErr := a.db.Begin()
		if dbErr == nil {
			for _, statement := range []string{
				`DELETE FROM media_items WHERE id=?`,
				`DELETE FROM scan_entries WHERE id=?`,
				`DELETE FROM content_hashes WHERE id=?`,
			} {
				if _, dbErr = tx.Exec(statement, itemID); dbErr != nil {
					break
				}
			}
			if dbErr == nil {
				dbErr = tx.Commit()
			} else {
				_ = tx.Rollback()
			}
		}
		if dbErr != nil {
			// Roll back the move only while its former path is still empty.
			if _, statErr := root.Lstat(rel); errors.Is(statErr, os.ErrNotExist) {
				if rollbackErr := root.Rename(target, rel); rollbackErr == nil {
					return dbErr
				}
			}
			a.removeMediaFromMemory(itemID)
			return fmt.Errorf("file retained in trash; index update failed: %w", dbErr)
		}
	}
	a.removeMediaFromMemory(itemID)
	return nil
}

func (a *app) removeMediaFromMemory(itemID string) {
	a.scanMu.Lock()
	defer a.scanMu.Unlock()
	items := make([]Item, 0, len(a.items))
	for _, item := range a.items {
		if item.ID != itemID {
			items = append(items, item)
		}
	}
	a.items = items
	delete(a.duplicateGroups, itemID)
}
