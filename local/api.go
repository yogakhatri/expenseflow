package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (a *App) routes(mux *http.ServeMux) {
	mux.HandleFunc("/api/health", a.handleHealth)
	mux.HandleFunc("/api/bootstrap", a.handleBootstrap)
	mux.HandleFunc("/api/parse", a.handleParse)
	mux.HandleFunc("/api/transactions", a.handleTransactions)
	mux.HandleFunc("/api/transactions/", a.handleTransactionByID)
	mux.HandleFunc("/api/transactions/bulk", a.handleBulkCreate)
	mux.HandleFunc("/api/transactions/bulk-delete", a.handleBulkDelete)
	mux.HandleFunc("/api/stats", a.handleStats)
	mux.HandleFunc("/api/income", a.handleIncome)
	mux.HandleFunc("/api/income/", a.handleIncomeByID)
	mux.HandleFunc("/api/budget", a.handleBudget)
	mux.HandleFunc("/api/settings", a.handleSettings)
	mux.HandleFunc("/api/categories", a.handleLookupCollection("categories"))
	mux.HandleFunc("/api/categories/", a.handleLookupItem("categories"))
	mux.HandleFunc("/api/payment-methods", a.handleLookupCollection("payment_methods"))
	mux.HandleFunc("/api/payment-methods/", a.handleLookupItem("payment_methods"))
	mux.HandleFunc("/api/accounts", a.handleLookupCollection("accounts"))
	mux.HandleFunc("/api/accounts/", a.handleLookupItem("accounts"))
	mux.HandleFunc("/api/favorites", a.handleFavorites)
	mux.HandleFunc("/api/favorites/", a.handleFavoriteByID)
	mux.HandleFunc("/api/rules", a.handleRules)
	mux.HandleFunc("/api/rules/", a.handleRuleByID)
	mux.HandleFunc("/api/recurring", a.handleRecurring)
	mux.HandleFunc("/api/recurring/", a.handleRecurringByID)
	mux.HandleFunc("/api/recurring/process", a.handleRecurringProcess)
	mux.HandleFunc("/api/pending", a.handlePending)
	mux.HandleFunc("/api/import", a.handleImport)
	mux.HandleFunc("/api/export", a.handleExport)
	mux.HandleFunc("/api/backup", a.handleBackup)
	mux.HandleFunc("/api/restore", a.handleRestore)
	mux.HandleFunc("/api/ai/status", a.handleAIStatus)
	mux.HandleFunc("/api/ai/test", a.handleAITest)
	mux.HandleFunc("/api/ai/parse", a.handleAIParse)

	fs := http.FileServer(http.Dir(a.cfg.WebDir))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, "Not found")
			return
		}
		path := filepath.Join(a.cfg.WebDir, strings.TrimPrefix(filepath.Clean(r.URL.Path), "/"))
		if r.URL.Path != "/" {
			if st, err := os.Stat(path); err == nil && !st.IsDir() {
				setStaticCacheHeaders(w, r.URL.Path)
				fs.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(a.cfg.WebDir, "index.html"))
	})
}

func setStaticCacheHeaders(w http.ResponseWriter, path string) {
	if path == "/sw.js" || path == "/index.html" {
		w.Header().Set("Cache-Control", "no-cache")
		return
	}
	if strings.HasSuffix(path, ".js") || strings.HasSuffix(path, ".css") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		return
	}
	if strings.HasPrefix(path, "/icons/") {
		w.Header().Set("Cache-Control", "public, max-age=604800")
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
}

func (a *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if err := a.db.Ping(); err != nil {
		writeJSON(w, 503, map[string]any{"ok": false, "database": false})
		return
	}
	a.maybeAutoBackup(todayFromHeader(r))
	writeJSON(w, 200, map[string]any{"ok": true, "database": true, "version": appVersion, "schema_version": a.currentSchemaVersion(), "mode": "local"})
}

func (a *App) handleParse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Text      string `json:"text"`
		LocalDate string `json:"local_date"`
	}
	if !decodeJSON(w, r, &req, a.cfg.MaxBodyBytes) {
		return
	}
	if !validateDate(req.LocalDate) {
		req.LocalDate = todayFromHeader(r)
	}
	items, err := a.parseComma(req.Text, req.LocalDate)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
