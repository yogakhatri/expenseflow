package main

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

type lookupRow struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Icon    string `json:"icon,omitempty"`
	Color   string `json:"color,omitempty"`
	Enabled bool   `json:"enabled"`
}

func (a *App) lookupItems(table string) ([]lookupRow, error) {
	if err := validTableName(table); err != nil {
		return nil, err
	}
	cols := "id,name,enabled"
	if table == "categories" {
		cols = "id,name,icon,color,enabled"
	}
	rows, err := a.db.Query("SELECT " + cols + " FROM " + table + " ORDER BY enabled DESC,name ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []lookupRow{}
	for rows.Next() {
		var x lookupRow
		var enabled int
		if table == "categories" {
			err = rows.Scan(&x.ID, &x.Name, &x.Icon, &x.Color, &enabled)
		} else {
			err = rows.Scan(&x.ID, &x.Name, &enabled)
		}
		if err != nil {
			return nil, err
		}
		x.Enabled = enabled == 1
		items = append(items, x)
	}
	return items, rows.Err()
}

func (a *App) handleLookupCollection(table string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			items, err := a.lookupItems(table)
			if err != nil {
				writeError(w, 500, "Could not load list")
				return
			}
			writeJSON(w, 200, map[string]any{"items": items})
		case http.MethodPost:
			var req struct {
				Name  string `json:"name"`
				Icon  string `json:"icon"`
				Color string `json:"color"`
			}
			if !decodeJSON(w, r, &req, a.cfg.MaxBodyBytes) {
				return
			}
			req.Name = strings.TrimSpace(req.Name)
			if len(req.Name) < 1 || len(req.Name) > 80 {
				writeError(w, 400, "Invalid name")
				return
			}
			a.writeMu.Lock()
			defer a.writeMu.Unlock()
			var res interface{ LastInsertId() (int64, error) }
			var err error
			if table == "categories" {
				if req.Icon == "" {
					req.Icon = "tag"
				}
				if req.Color == "" {
					req.Color = "#64748b"
				}
				rr, e := a.db.Exec(`INSERT INTO categories(name,icon,color) VALUES(?,?,?)`, req.Name, req.Icon, req.Color)
				res, err = rr, e
			} else {
				rr, e := a.db.Exec("INSERT INTO "+table+"(name) VALUES(?)", req.Name)
				res, err = rr, e
			}
			if err != nil {
				writeError(w, 409, "Name already exists or is invalid")
				return
			}
			id, _ := res.LastInsertId()
			writeJSON(w, 201, map[string]any{"id": id})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (a *App) handleLookupItem(table string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		prefix := map[string]string{"categories": "/api/categories/", "payment_methods": "/api/payment-methods/", "accounts": "/api/accounts/"}[table]
		id, err := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, prefix), 10, 64)
		if err != nil || id <= 0 {
			writeError(w, 400, "Invalid ID")
			return
		}
		switch r.Method {
		case http.MethodPut:
			var req struct {
				Name    string `json:"name"`
				Icon    string `json:"icon"`
				Color   string `json:"color"`
				Enabled *bool  `json:"enabled"`
			}
			if !decodeJSON(w, r, &req, a.cfg.MaxBodyBytes) {
				return
			}
			req.Name = strings.TrimSpace(req.Name)
			if req.Name == "" {
				writeError(w, 400, "Name is required")
				return
			}
			en := 1
			if req.Enabled != nil && !*req.Enabled {
				en = 0
			}
			a.writeMu.Lock()
			defer a.writeMu.Unlock()
			var e error
			if table == "categories" {
				if req.Icon == "" {
					req.Icon = "tag"
				}
				if req.Color == "" {
					req.Color = "#64748b"
				}
				_, e = a.db.Exec(`UPDATE categories SET name=?,icon=?,color=?,enabled=?,updated_at=datetime('now') WHERE id=?`, req.Name, req.Icon, req.Color, en, id)
			} else {
				_, e = a.db.Exec("UPDATE "+table+" SET name=?,enabled=?,updated_at=datetime('now') WHERE id=?", req.Name, en, id)
			}
			if e != nil {
				writeError(w, 409, "Could not update item")
				return
			}
			writeJSON(w, 200, map[string]any{"ok": true})
		case http.MethodDelete:
			refs := map[string]string{"categories": "category_id", "payment_methods": "payment_method_id", "accounts": "account_id"}
			var n int
			_ = a.db.QueryRow("SELECT COUNT(1) FROM transactions WHERE "+refs[table]+"=?", id).Scan(&n)
			if n > 0 {
				writeError(w, 409, "Item is referenced; disable it instead")
				return
			}
			a.writeMu.Lock()
			defer a.writeMu.Unlock()
			if _, e := a.db.Exec("DELETE FROM "+table+" WHERE id=?", id); e != nil {
				writeError(w, 409, "Could not delete item")
				return
			}
			writeJSON(w, 200, map[string]any{"ok": true})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func validTableName(table string) error {
	if table != "categories" && table != "payment_methods" && table != "accounts" {
		return fmt.Errorf("invalid table")
	}
	return nil
}
