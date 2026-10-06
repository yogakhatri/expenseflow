package main

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
)

func (a *App) handleFavorites(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := a.db.Query(`SELECT f.id,f.description,f.amount_paise,f.category_id,COALESCE(c.name,''),f.payment_method_id,COALESCE(p.name,''),f.account_id,COALESCE(a.name,'')
			FROM favorites f LEFT JOIN categories c ON c.id=f.category_id LEFT JOIN payment_methods p ON p.id=f.payment_method_id LEFT JOIN accounts a ON a.id=f.account_id ORDER BY f.id DESC`)
		if err != nil {
			writeError(w, 500, "Could not load favorites")
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id int64
			var desc, cat, pay, acct string
			var amount, catID, payID, acctID sql.NullInt64
			if err := rows.Scan(&id, &desc, &amount, &catID, &cat, &payID, &pay, &acctID, &acct); err != nil {
				writeError(w, 500, "Could not load favorites")
				return
			}
			item := map[string]any{"id": id, "description": desc, "category_name": cat, "payment_name": pay, "account_name": acct}
			if amount.Valid {
				item["amount_paise"] = amount.Int64
			} else {
				item["amount_paise"] = nil
			}
			if catID.Valid {
				item["category_id"] = catID.Int64
			} else {
				item["category_id"] = nil
			}
			if payID.Valid {
				item["payment_method_id"] = payID.Int64
			} else {
				item["payment_method_id"] = nil
			}
			if acctID.Valid {
				item["account_id"] = acctID.Int64
			} else {
				item["account_id"] = nil
			}
			items = append(items, item)
		}
		writeJSON(w, 200, map[string]any{"items": items})
	case http.MethodPost:
		var req struct {
			Description     string `json:"description"`
			AmountPaise     *int64 `json:"amount_paise"`
			CategoryID      *int64 `json:"category_id"`
			PaymentMethodID *int64 `json:"payment_method_id"`
			AccountID       *int64 `json:"account_id"`
		}
		if !decodeJSON(w, r, &req, a.cfg.MaxBodyBytes) {
			return
		}
		req.Description = strings.TrimSpace(req.Description)
		if req.Description == "" || len(req.Description) > 300 {
			writeError(w, 400, "Invalid description")
			return
		}
		if req.AmountPaise != nil && *req.AmountPaise <= 0 {
			writeError(w, 400, "Invalid amount")
			return
		}
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		res, err := a.db.Exec(`INSERT INTO favorites(description,amount_paise,category_id,payment_method_id,account_id) VALUES(?,?,?,?,?)`, req.Description, req.AmountPaise, req.CategoryID, req.PaymentMethodID, req.AccountID)
		if err != nil {
			writeError(w, 400, "Invalid favorite")
			return
		}
		id, _ := res.LastInsertId()
		writeJSON(w, 201, map[string]any{"id": id})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (a *App) handleFavoriteByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	id, err := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/api/favorites/"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, 400, "Invalid ID")
		return
	}
	a.writeMu.Lock()
	defer a.writeMu.Unlock()
	if _, err = a.db.Exec(`DELETE FROM favorites WHERE id=?`, id); err != nil {
		writeError(w, 500, "Could not delete favorite")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
