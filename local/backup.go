package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var safeBackupName = regexp.MustCompile(`^[A-Za-z0-9._-]+\.db$`)

func (a *App) createBackup(tag string) error {
	a.writeMu.Lock()
	defer a.writeMu.Unlock()
	name := time.Now().Format("2006-01-02_150405.000000000")
	if tag != "" {
		name += "_" + strings.Map(func(r rune) rune {
			if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' {
				return r
			}
			return '-'
		}, tag)
	}
	dst := filepath.Join(a.cfg.BackupDir, name+".db")
	// SQLite produces a consistent snapshot, including committed WAL pages.
	if _, err := a.db.Exec(`VACUUM INTO ?`, dst); err != nil {
		_ = os.Remove(dst)
		return err
	}
	if err := os.Chmod(dst, 0o600); err != nil {
		return err
	}
	return a.pruneBackups()
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err = io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

func (a *App) pruneBackups() error {
	entries, err := os.ReadDir(a.cfg.BackupDir)
	if err != nil {
		return err
	}
	var daily, weekly, other []os.DirEntry
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".db") {
			continue
		}
		switch {
		case strings.Contains(e.Name(), "_auto-daily.db"):
			daily = append(daily, e)
		case strings.Contains(e.Name(), "_auto-weekly.db"):
			weekly = append(weekly, e)
		default:
			other = append(other, e)
		}
	}
	for _, list := range [][]os.DirEntry{daily, weekly, other} {
		sort.Slice(list, func(i, j int) bool { return list[i].Name() > list[j].Name() })
	}
	keepDaily := boundedSettingInt(a.setting("backup_retention_daily", "7"), 7, 1, 90)
	keepWeekly := boundedSettingInt(a.setting("backup_retention_weekly", "4"), 4, 1, 52)
	for _, pair := range []struct {
		files []os.DirEntry
		keep  int
	}{{daily, keepDaily}, {weekly, keepWeekly}, {other, 20}} {
		if len(pair.files) <= pair.keep {
			continue
		}
		for _, e := range pair.files[pair.keep:] {
			_ = os.Remove(filepath.Join(a.cfg.BackupDir, e.Name()))
		}
	}
	return nil
}

func boundedSettingInt(value string, fallback, min, max int) int {
	n, err := strconv.Atoi(value)
	if err != nil || n < min || n > max {
		return fallback
	}
	return n
}

func (a *App) handleBackup(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		entries, _ := os.ReadDir(a.cfg.BackupDir)
		names := []string{}
		for _, e := range entries {
			if !e.IsDir() && safeBackupName.MatchString(e.Name()) {
				names = append(names, e.Name())
			}
		}
		sort.Sort(sort.Reverse(sort.StringSlice(names)))
		writeJSON(w, 200, map[string]any{"items": names})
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if err := a.createBackup("manual"); err != nil {
		writeError(w, 500, "Backup failed")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) handleRestore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &req, a.cfg.MaxBodyBytes) {
		return
	}
	if !safeBackupName.MatchString(req.Name) {
		writeError(w, 400, "Invalid backup name")
		return
	}
	src := filepath.Join(a.cfg.BackupDir, req.Name)
	if _, err := os.Stat(src); err != nil {
		writeError(w, 404, "Backup not found")
		return
	}

	// Validate a temporary copy before touching the live database.
	tmp := a.cfg.DBPath + ".restore"
	_ = os.Remove(tmp)
	_ = os.Remove(tmp + "-wal")
	_ = os.Remove(tmp + "-shm")
	defer func() {
		_ = os.Remove(tmp)
		_ = os.Remove(tmp + "-wal")
		_ = os.Remove(tmp + "-shm")
	}()
	if err := copyFile(src, tmp); err != nil {
		writeError(w, 500, "Restore failed")
		return
	}
	testDB, err := openDB(tmp)
	if err != nil {
		_ = os.Remove(tmp)
		writeError(w, 400, "Backup is not a valid database")
		return
	}
	var check string
	err = testDB.QueryRow(`PRAGMA quick_check`).Scan(&check)
	if err != nil || check != "ok" {
		_ = testDB.Close()
		writeError(w, 400, "Backup database failed integrity check")
		return
	}
	stagedConfig := a.cfg
	stagedConfig.DBPath = tmp
	staged := &App{cfg: stagedConfig, db: testDB}
	if err := staged.migrateDatabase(false); err != nil {
		_ = testDB.Close()
		writeError(w, 400, "Backup database could not be migrated")
		return
	}
	// Flush migration changes before moving the main SQLite file.
	if _, err := testDB.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		_ = testDB.Close()
		writeError(w, 500, "Could not prepare restored database")
		return
	}
	if err := testDB.Close(); err != nil {
		writeError(w, 500, "Could not prepare restored database")
		return
	}

	if err := a.createBackup("before-restore"); err != nil {
		_ = os.Remove(tmp)
		writeError(w, 500, "Could not create safety backup")
		return
	}

	a.writeMu.Lock()
	defer a.writeMu.Unlock()
	if err := a.db.Close(); err != nil {
		_ = os.Remove(tmp)
		writeError(w, 500, "Could not close database")
		return
	}
	_ = os.Remove(a.cfg.DBPath + "-wal")
	_ = os.Remove(a.cfg.DBPath + "-shm")
	if err := os.Rename(tmp, a.cfg.DBPath); err != nil {
		db, _ := openDB(a.cfg.DBPath)
		if db != nil {
			a.db = db
		}
		writeError(w, 500, "Restore failed")
		return
	}
	db, err := openDB(a.cfg.DBPath)
	if err != nil {
		writeError(w, 500, "Restored database could not be opened")
		return
	}
	a.db = db
	writeJSON(w, 200, map[string]any{"ok": true, "message": fmt.Sprintf("Restored %s", req.Name)})
}

func (a *App) maybeAutoBackup(localDate string) {
	a.backupMu.Lock()
	defer a.backupMu.Unlock()
	schedule := strings.ToLower(a.setting("backup_schedule", "off"))
	if schedule == "off" || !validateDate(localDate) {
		return
	}
	last := a.setting("last_auto_backup", "")
	shouldRun := false
	switch schedule {
	case "daily":
		shouldRun = last != localDate
	case "weekly":
		currentDate, err := time.Parse("2006-01-02", localDate)
		if err != nil {
			return
		}
		cy, cw := currentDate.ISOWeek()
		if lastDate, err := time.Parse("2006-01-02", last); err != nil {
			shouldRun = true
		} else {
			ly, lw := lastDate.ISOWeek()
			shouldRun = cy != ly || cw != lw
		}
	default:
		return
	}
	if !shouldRun {
		return
	}
	if err := a.createBackup("auto-" + schedule); err != nil {
		return
	}
	_, _ = a.db.Exec(`INSERT INTO settings(key,value) VALUES('last_auto_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')`, localDate)
}
