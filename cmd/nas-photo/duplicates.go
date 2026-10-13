package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

func contentDigest(path string, size, modifiedNS int64) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	before, err := f.Stat()
	if err != nil {
		return "", err
	}
	if !before.Mode().IsRegular() || before.Size() != size || before.ModTime().UnixNano() != modifiedNS {
		return "", errors.New("file changed before hashing")
	}
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", err
	}
	after, err := f.Stat()
	if err != nil {
		return "", err
	}
	if n != size || after.Size() != size || !after.ModTime().Equal(before.ModTime()) {
		return "", errors.New("file changed while hashing")
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (a *app) itemDigest(item Item) (string, error) {
	if a.db != nil && item.ID != "" {
		var digest string
		err := a.db.QueryRow(`SELECT digest FROM content_hashes WHERE id=? AND size=? AND modified_ns=?`,
			item.ID, item.Size, item.Modified.UnixNano()).Scan(&digest)
		if err == nil {
			return digest, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
	}
	digest, err := contentDigest(item.Path, item.Size, item.Modified.UnixNano())
	if err == nil && a.db != nil && item.ID != "" {
		_, err = a.db.Exec(`INSERT OR REPLACE INTO content_hashes(id,size,modified_ns,digest)
SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM media_items WHERE id=? AND size=? AND modified_ns=?)`,
			item.ID, item.Size, item.Modified.UnixNano(), digest, item.ID, item.Size, item.Modified.UnixNano())
	}
	return digest, err
}

func duplicateCounts(items []Item, groups map[string]string) map[string]int {
	counts := map[string]int{}
	for _, item := range items {
		if group := groups[item.ID]; group != "" && !isTrashPath(item.Path) {
			counts[group]++
		}
	}
	return counts
}

func groupDuplicateItems(items []Item, groups map[string]string) []Item {
	order := []string{}
	byGroup := map[string][]Item{}
	for _, item := range items {
		group := groups[item.ID]
		if _, ok := byGroup[group]; !ok {
			order = append(order, group)
		}
		byGroup[group] = append(byGroup[group], item)
	}
	out := make([]Item, 0, len(items))
	for _, group := range order {
		out = append(out, byGroup[group]...)
	}
	return out
}

func (a *app) refreshDuplicateGroups(ctx context.Context) {
	a.scanMu.Lock()
	items := append([]Item(nil), a.items...)
	a.scanPhase = "duplicates"
	a.scanDone = 0
	a.scanTotal = 0
	a.scanMu.Unlock()
	bySize := map[int64][]Item{}
	for _, item := range items {
		if !isTrashPath(item.Path) {
			bySize[item.Size] = append(bySize[item.Size], item)
		}
	}
	total := 0
	for _, candidates := range bySize {
		if len(candidates) > 1 {
			total += len(candidates)
		}
	}
	a.scanMu.Lock()
	a.scanTotal = total
	a.scanMu.Unlock()
	groups := map[string]string{}
	for _, candidates := range bySize {
		if len(candidates) < 2 {
			continue
		}
		byDigest := map[string][]Item{}
		for _, item := range candidates {
			if ctx.Err() != nil {
				return
			}
			digest, err := a.itemDigest(item)
			if err == nil {
				// Compare bytes as well, including when using a cached digest.
				matched := false
				for _, representative := range byDigest[digest] {
					equal, compareErr := uploadFilesEqual(item.Path, representative.Path, item.Size)
					if compareErr != nil {
						err = compareErr
						continue
					}
					if equal {
						groups[item.ID] = representative.ID
						groups[representative.ID] = representative.ID
						matched = true
						break
					}
				}
				if !matched {
					byDigest[digest] = append(byDigest[digest], item)
				}
			}
			if err != nil {
				a.addScanError(fmt.Sprintf("%s: duplicate check: %v", item.Name, err))
			}
			a.scanMu.Lock()
			a.scanDone++
			a.scanMu.Unlock()
		}
	}
	// A trash operation may have completed during hashing. Only publish IDs
	// that still refer to the same indexed file.
	snapshot := map[string]Item{}
	for _, item := range items {
		snapshot[item.ID] = item
	}
	a.scanMu.Lock()
	current := map[string]string{}
	for _, item := range a.items {
		old, ok := snapshot[item.ID]
		if ok && old.Path == item.Path && old.Size == item.Size && old.Modified.Equal(item.Modified) {
			if group := groups[item.ID]; group != "" {
				current[item.ID] = group
			}
		}
	}
	a.duplicateGroups = current
	a.scanMu.Unlock()
}

// Use the current filesystem, including files not indexed by the last scan.
// Only files of an incoming size are read, and trash is never a candidate.
func (a *app) uploadDuplicateCandidates(ctx context.Context, batch *uploadBatch) map[string][]Item {
	sizes := map[int64]bool{}
	for _, file := range batch.Files {
		sizes[file.Size] = true
	}
	a.st.mu.RLock()
	roots := append([]Root(nil), a.st.Roots...)
	a.st.mu.RUnlock()
	candidates := map[string][]Item{}
	for _, root := range roots {
		_ = filepath.WalkDir(root.Path, func(path string, entry fs.DirEntry, err error) error {
			if ctx.Err() != nil {
				return fs.SkipAll
			}
			if err != nil {
				if entry != nil && entry.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			if entry.IsDir() {
				if isTrashPath(path) {
					return fs.SkipDir
				}
				return nil
			}
			if kind(entry.Name()) == "" || isTrashPath(path) {
				return nil
			}
			info, err := entry.Info()
			if err != nil || !info.Mode().IsRegular() || !sizes[info.Size()] {
				return nil
			}
			rel, err := filepath.Rel(root.Path, path)
			if err != nil {
				return nil
			}
			item := Item{ID: stableID(root.ID, rel), RootID: root.ID, Path: path, Size: info.Size(), Modified: info.ModTime()}
			digest, err := a.itemDigest(item)
			if err == nil {
				key := fmt.Sprintf("%d:%s", item.Size, digest)
				candidates[key] = append(candidates[key], item)
			}
			return nil
		})
	}
	return candidates
}

func (a *app) markDuplicateUploads(ctx context.Context, batch *uploadBatch, destination string) error {
	candidates := a.uploadDuplicateCandidates(ctx, batch)
	for i := range batch.Files {
		if err := ctx.Err(); err != nil {
			return err
		}
		file := &batch.Files[i]
		file.Skipped = false
		file.duplicatePath = ""
		part, _, err := uploadPartPaths(batch.ID, i)
		if err != nil {
			return err
		}
		info, err := os.Stat(part)
		if err != nil {
			return err
		}
		digest, err := contentDigest(part, file.Size, info.ModTime().UnixNano())
		if err != nil {
			return err
		}
		key := fmt.Sprintf("%d:%s", file.Size, digest)
		// A partially committed retry keeps ownership of its planned file.
		reused := false
		if file.TargetName != "" {
			reused, _ = uploadFilesEqual(part, filepath.Join(destination, file.TargetName), file.Size)
		}
		if !reused {
			for _, candidate := range candidates[key] {
				equal, err := uploadFilesEqual(part, candidate.Path, file.Size)
				if err == nil && equal {
					file.Skipped = true
					file.duplicatePath = candidate.Path
					break
				}
			}
		}
		if !file.Skipped {
			candidates[key] = append(candidates[key], Item{Path: part, Size: file.Size})
		}
	}
	return nil
}

func verifySkippedUploads(batch *uploadBatch, destination string) error {
	committed := map[string]string{}
	for i, file := range batch.Files {
		if !file.Skipped {
			part, _, _ := uploadPartPaths(batch.ID, i)
			committed[part] = filepath.Join(destination, file.TargetName)
		}
	}
	for i, file := range batch.Files {
		if !file.Skipped {
			continue
		}
		candidate := file.duplicatePath
		if final, ok := committed[candidate]; ok {
			candidate = final
		}
		part, _, err := uploadPartPaths(batch.ID, i)
		if err != nil {
			return err
		}
		equal, err := uploadFilesEqual(part, candidate, file.Size)
		if err != nil {
			return err
		}
		if !equal {
			return errors.New("duplicate changed before upload completed")
		}
	}
	return nil
}
