package main

import "net/http"

func (a *App) currentSchemaVersion() int {
	var version int
	_ = a.db.QueryRow(`SELECT COALESCE(MAX(version),0) FROM schema_version`).Scan(&version)
	return version
}

func (a *App) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	a.maybeAutoBackup(todayFromHeader(r))

	settings := map[string]string{}
	rows, err := a.db.Query(`SELECT key,value FROM settings ORDER BY key`)
	if err != nil {
		writeError(w, 500, "Could not load settings")
		return
	}
	for rows.Next() {
		var key, value string
		if rows.Scan(&key, &value) == nil {
			settings[key] = value
		}
	}
	rows.Close()

	categories, err := a.lookupItems("categories")
	if err != nil {
		writeError(w, 500, "Could not load categories")
		return
	}
	payments, err := a.lookupItems("payment_methods")
	if err != nil {
		writeError(w, 500, "Could not load payment methods")
		return
	}
	accounts, err := a.lookupItems("accounts")
	if err != nil {
		writeError(w, 500, "Could not load accounts")
		return
	}

	writeJSON(w, 200, map[string]any{
		"version":        appVersion,
		"schema_version": a.currentSchemaVersion(),
		"mode":           "local",
		"settings":       settings,
		"categories":     categories,
		"payments":       payments,
		"accounts":       accounts,
	})
}
