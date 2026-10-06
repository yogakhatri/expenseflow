package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	_ "github.com/mattn/go-sqlite3"
)

type App struct {
	cfg     Config
	db      *sql.DB
	writeMu sync.Mutex
}

func newApp(cfg Config) (*App, error) {
	db, err := openDB(cfg.DBPath)
	if err != nil {
		return nil, err
	}
	app := &App{cfg: cfg, db: db}
	if err := app.runMigrations(); err != nil {
		db.Close()
		return nil, err
	}
	if err := app.seedEnvSettings(); err != nil {
		db.Close()
		return nil, err
	}
	return app, nil
}

func openDB(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_foreign_keys=on&_busy_timeout=5000&_journal_mode=WAL", path)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func (a *App) runMigrations() error {
	if _, err := a.db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`); err != nil {
		return err
	}
	entries, err := os.ReadDir(a.cfg.MigrationDir)
	if err != nil {
		return err
	}
	type migration struct {
		version int
		path    string
	}
	var all []migration
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		parts := strings.SplitN(e.Name(), "_", 2)
		v, err := strconv.Atoi(parts[0])
		if err != nil {
			continue
		}
		all = append(all, migration{v, filepath.Join(a.cfg.MigrationDir, e.Name())})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].version < all[j].version })

	var current int
	if err := a.db.QueryRow(`SELECT COALESCE(MAX(version),0) FROM schema_version`).Scan(&current); err != nil {
		return err
	}
	pending := make([]migration, 0, len(all))
	for _, m := range all {
		if m.version > current {
			pending = append(pending, m)
		}
	}
	if len(pending) == 0 {
		return nil
	}
	if current > 0 {
		tag := fmt.Sprintf("pre-migration-v%d-to-v%d", current, pending[len(pending)-1].version)
		if err := a.createBackup(tag); err != nil {
			return fmt.Errorf("backup before migration: %w", err)
		}
	}

	for _, m := range pending {
		body, err := os.ReadFile(m.path)
		if err != nil {
			return err
		}
		tx, err := a.db.Begin()
		if err != nil {
			return err
		}
		if _, err = tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: %w", m.version, err)
		}
		if _, err = tx.Exec(`INSERT INTO schema_version(version) VALUES(?)`, m.version); err != nil {
			tx.Rollback()
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) seedEnvSettings() error {
	pairs := map[string]string{}
	if os.Getenv("EXPENSEFLOW_AI_ENABLED") != "" {
		pairs["ai_enabled"] = strconv.FormatBool(a.cfg.AIEnabled)
	}
	if os.Getenv("EXPENSEFLOW_AI_URL") != "" {
		pairs["ai_url"] = a.cfg.AIURL
	}
	if os.Getenv("EXPENSEFLOW_AI_MODEL") != "" {
		pairs["ai_model"] = a.cfg.AIModel
	}
	if os.Getenv("EXPENSEFLOW_AI_UNLOAD") != "" {
		pairs["ai_unload"] = strconv.FormatBool(a.cfg.AIUnload)
	}
	for k, v := range pairs {
		if _, err := a.db.Exec(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')`, k, v); err != nil {
			return err
		}
	}
	return nil
}
