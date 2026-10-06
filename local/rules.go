package main

import (
	"net/http"
	"strconv"
	"strings"
)

func (a *App) handleRules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := a.db.Query(`SELECT r.id,r.keyword,r.merchant,r.category_id,c.name,r.priority,r.enabled FROM categorization_rules r JOIN categories c ON c.id=r.category_id ORDER BY r.priority,r.id`)
		if err != nil {
			writeError(w, 500, "Could not load rules")
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, catID int64
			var keyword, merchant, cat string
			var priority, en int
			if rows.Scan(&id, &keyword, &merchant, &catID, &cat, &priority, &en) == nil {
				items = append(items, map[string]any{"id": id, "keyword": keyword, "merchant": merchant, "category_id": catID, "category_name": cat, "priority": priority, "enabled": en == 1})
			}
		}
		writeJSON(w, 200, map[string]any{"items": items})
	case http.MethodPost:
		var req struct {
			Keyword    string `json:"keyword"`
			Merchant   string `json:"merchant"`
			CategoryID int64  `json:"category_id"`
			Priority   int    `json:"priority"`
			Enabled    *bool  `json:"enabled"`
		}
		if !decodeJSON(w, r, &req, a.cfg.MaxBodyBytes) {
			return
		}
		req.Keyword = strings.TrimSpace(req.Keyword)
		req.Merchant = strings.TrimSpace(req.Merchant)
		if req.Keyword == "" && req.Merchant == "" {
			writeError(w, 400, "Keyword or merchant is required")
			return
		}
		if ok, _ := a.idExists("categories", req.CategoryID); !ok {
			writeError(w, 400, "Invalid category")
			return
		}
		if req.Priority == 0 {
			req.Priority = 100
		}
		en := 1
		if req.Enabled != nil && !*req.Enabled {
			en = 0
		}
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		res, err := a.db.Exec(`INSERT INTO categorization_rules(keyword,merchant,category_id,priority,enabled) VALUES(?,?,?,?,?)`, req.Keyword, req.Merchant, req.CategoryID, req.Priority, en)
		if err != nil {
			writeError(w, 400, "Invalid rule")
			return
		}
		id, _ := res.LastInsertId()
		writeJSON(w, 201, map[string]any{"id": id})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (a *App) handleRuleByID(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/api/rules/"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, 400, "Invalid ID")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var req struct {
			Keyword    string `json:"keyword"`
			Merchant   string `json:"merchant"`
			CategoryID int64  `json:"category_id"`
			Priority   int    `json:"priority"`
			Enabled    bool   `json:"enabled"`
		}
		if !decodeJSON(w, r, &req, a.cfg.MaxBodyBytes) {
			return
		}
		if strings.TrimSpace(req.Keyword) == "" && strings.TrimSpace(req.Merchant) == "" {
			writeError(w, 400, "Keyword or merchant is required")
			return
		}
		if ok, _ := a.idExists("categories", req.CategoryID); !ok {
			writeError(w, 400, "Invalid category")
			return
		}
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		_, err := a.db.Exec(`UPDATE categorization_rules SET keyword=?,merchant=?,category_id=?,priority=?,enabled=? WHERE id=?`, strings.TrimSpace(req.Keyword), strings.TrimSpace(req.Merchant), req.CategoryID, req.Priority, boolInt(req.Enabled), id)
		if err != nil {
			writeError(w, 400, "Could not update rule")
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	case http.MethodDelete:
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		_, err := a.db.Exec(`DELETE FROM categorization_rules WHERE id=?`, id)
		if err != nil {
			writeError(w, 500, "Could not delete rule")
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}
