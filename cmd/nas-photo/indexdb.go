package main

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

func openIndexDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	for _, pragma := range []string{
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
		"PRAGMA synchronous=NORMAL",
		"PRAGMA journal_mode=WAL",
	} {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, fmt.Errorf("%s: %w", pragma, err)
		}
	}
	_, err = db.Exec(`
CREATE TABLE IF NOT EXISTS media_items (
	id TEXT PRIMARY KEY,
	root_id TEXT NOT NULL,
	path TEXT NOT NULL,
	name TEXT NOT NULL,
	kind TEXT NOT NULL,
	size INTEGER NOT NULL,
	modified_ns INTEGER NOT NULL,
	width INTEGER NOT NULL DEFAULT 0,
	height INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS media_items_root ON media_items(root_id);
CREATE INDEX IF NOT EXISTS media_items_modified ON media_items(modified_ns, id);
CREATE INDEX IF NOT EXISTS media_items_name ON media_items(name, id);
CREATE TABLE IF NOT EXISTS scan_entries (
	scan_id TEXT NOT NULL,
	id TEXT NOT NULL,
	root_id TEXT NOT NULL,
	path TEXT NOT NULL,
	name TEXT NOT NULL,
	kind TEXT NOT NULL,
	size INTEGER NOT NULL,
	modified_ns INTEGER NOT NULL,
	width INTEGER NOT NULL DEFAULT 0,
	height INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY(scan_id, id)
);
CREATE INDEX IF NOT EXISTS scan_entries_root ON scan_entries(scan_id, root_id);
`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func loadIndexedItems(db *sql.DB) ([]Item, error) {
	if db == nil {
		return nil, nil
	}
	rows, err := db.Query(`SELECT id, root_id, path, name, kind, size, modified_ns, width, height FROM media_items`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Item{}
	for rows.Next() {
		var item Item
		var modified int64
		if err := rows.Scan(&item.ID, &item.RootID, &item.Path, &item.Name, &item.Kind, &item.Size, &modified, &item.Width, &item.Height); err != nil {
			return nil, err
		}
		item.Modified = time.Unix(0, modified)
		items = append(items, item)
	}
	return items, rows.Err()
}

func replaceIndexedItems(db *sql.DB, items []Item) error {
	if db == nil {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`DELETE FROM media_items`); err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO media_items(id,root_id,path,name,kind,size,modified_ns,width,height) VALUES(?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, item := range items {
		if _, err = stmt.Exec(item.ID, item.RootID, item.Path, item.Name, item.Kind, item.Size, item.Modified.UnixNano(), item.Width, item.Height); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func stageIndexedItems(db *sql.DB, scanID string, items []Item) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`INSERT OR REPLACE INTO scan_entries(scan_id,id,root_id,path,name,kind,size,modified_ns,width,height) VALUES(?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, item := range items {
		if _, err = stmt.Exec(scanID, item.ID, item.RootID, item.Path, item.Name, item.Kind, item.Size, item.Modified.UnixNano(), item.Width, item.Height); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func commitStagedScan(db *sql.DB, scanID string, rootIDs []string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, rootID := range rootIDs {
		if _, err = tx.Exec(`DELETE FROM media_items WHERE root_id=?`, rootID); err != nil {
			return err
		}
		if _, err = tx.Exec(`
INSERT INTO media_items(id,root_id,path,name,kind,size,modified_ns,width,height)
SELECT id,root_id,path,name,kind,size,modified_ns,width,height
FROM scan_entries WHERE scan_id=? AND root_id=?`, scanID, rootID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func discardStagedRoot(db *sql.DB, scanID, rootID string) error {
	_, err := db.Exec(`DELETE FROM scan_entries WHERE scan_id=? AND root_id=?`, scanID, rootID)
	return err
}

func discardScan(db *sql.DB, scanID string) error {
	_, err := db.Exec(`DELETE FROM scan_entries WHERE scan_id=?`, scanID)
	return err
}

func clearStagedScans(db *sql.DB) error {
	_, err := db.Exec(`DELETE FROM scan_entries`)
	return err
}
