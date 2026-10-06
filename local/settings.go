package main

import (
	"net/http"
	"net/url"
	"strings"
)

var allowedSettings = map[string]bool{
	"start_page": true,
	"theme":      true, "compact_rows": true,
	"ai_enabled": true, "ai_url": true, "ai_model": true, "ai_unload": true,
	"backup_schedule": true, "backup_retention_daily": true, "backup_retention_weekly": true,
}

func (a *App) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := a.db.Query(`SELECT key,value FROM settings ORDER BY key`)
		if err != nil {
			writeError(w, 500, "Could not load settings")
			return
		}
		defer rows.Close()
		out := map[string]string{}
		for rows.Next() {
			var k, v string
			if rows.Scan(&k, &v) == nil {
				out[k] = v
			}
		}
		writeJSON(w, 200, out)
	case http.MethodPut:
		var req map[string]string
		if !decodeJSON(w, r, &req, a.cfg.MaxBodyBytes) {
			return
		}
		if len(req) > 20 {
			writeError(w, 400, "Too many settings")
			return
		}
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		tx, err := a.db.Begin()
		if err != nil {
			writeError(w, 500, "Could not update settings")
			return
		}
		defer tx.Rollback()
		for k, v := range req {
			if !allowedSettings[k] {
				writeError(w, 400, "Unknown setting: "+k)
				return
			}
			if len(v) > 500 {
				writeError(w, 400, "Setting value is too long")
				return
			}
			if k == "ai_url" && !allowedAIURL(v) {
				writeError(w, 400, "Ollama URL must use localhost, loopback, or the Docker ollama hostname")
				return
			}
			if _, err := tx.Exec(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')`, k, v); err != nil {
				writeError(w, 500, "Could not update settings")
				return
			}
		}
		if err := tx.Commit(); err != nil {
			writeError(w, 500, "Could not update settings")
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (a *App) setting(key, fallback string) string {
	var v string
	if err := a.db.QueryRow(`SELECT value FROM settings WHERE key=?`, key).Scan(&v); err != nil {
		return fallback
	}
	return v
}

func allowedAIURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "http" || u.Hostname() == "" || u.User != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "127.0.0.1" || host == "localhost" || host == "::1" || host == "ollama" || host == "host.docker.internal"
}
