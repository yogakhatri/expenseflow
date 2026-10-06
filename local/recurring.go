package main

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type recurringInput struct {
	Description     string `json:"description"`
	AmountPaise     int64  `json:"amount_paise"`
	CategoryID      int64  `json:"category_id"`
	PaymentMethodID int64  `json:"payment_method_id"`
	AccountID       *int64 `json:"account_id"`
	Frequency       string `json:"frequency"`
	AnchorDay       int    `json:"anchor_day"`
	NextDate        string `json:"next_date"`
	Enabled         bool   `json:"enabled"`
}

func (a *App) validateRecurring(x *recurringInput) bool {
	x.Description = strings.TrimSpace(x.Description)
	if x.Description == "" || x.AmountPaise <= 0 || !validateDate(x.NextDate) {
		return false
	}
	if x.Frequency != "weekly" && x.Frequency != "monthly" && x.Frequency != "yearly" {
		return false
	}
	if ok, _ := a.idExists("categories", x.CategoryID); !ok {
		return false
	}
	if ok, _ := a.idExists("payment_methods", x.PaymentMethodID); !ok {
		return false
	}
	if x.AccountID != nil {
		if ok, _ := a.idExists("accounts", *x.AccountID); !ok {
			return false
		}
	}
	if x.AnchorDay == 0 {
		d, _ := time.Parse("2006-01-02", x.NextDate)
		x.AnchorDay = d.Day()
	}
	return x.AnchorDay >= 1 && x.AnchorDay <= 31
}

func (a *App) handleRecurring(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := a.db.Query(`SELECT r.id,r.description,r.amount_paise,r.category_id,c.name,r.payment_method_id,p.name,r.account_id,COALESCE(a.name,''),r.frequency,r.anchor_day,r.next_date,r.enabled,r.last_generated_date FROM recurring_expenses r JOIN categories c ON c.id=r.category_id JOIN payment_methods p ON p.id=r.payment_method_id LEFT JOIN accounts a ON a.id=r.account_id ORDER BY r.enabled DESC,r.next_date`)
		if err != nil {
			writeError(w, 500, "Could not load recurring expenses")
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, amt, catID, payID int64
			var desc, cat, pay, acct, freq, next string
			var account sql.NullInt64
			var anchor, en int
			var last sql.NullString
			if rows.Scan(&id, &desc, &amt, &catID, &cat, &payID, &pay, &account, &acct, &freq, &anchor, &next, &en, &last) == nil {
				var aid any = nil
				if account.Valid {
					aid = account.Int64
				}
				var ld any = nil
				if last.Valid {
					ld = last.String
				}
				items = append(items, map[string]any{"id": id, "description": desc, "amount_paise": amt, "category_id": catID, "category_name": cat, "payment_method_id": payID, "payment_name": pay, "account_id": aid, "account_name": acct, "frequency": freq, "anchor_day": anchor, "next_date": next, "enabled": en == 1, "last_generated_date": ld})
			}
		}
		writeJSON(w, 200, map[string]any{"items": items})
	case http.MethodPost:
		var x recurringInput
		if !decodeJSON(w, r, &x, a.cfg.MaxBodyBytes) {
			return
		}
		if !a.validateRecurring(&x) {
			writeError(w, 400, "Invalid recurring expense")
			return
		}
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		res, err := a.db.Exec(`INSERT INTO recurring_expenses(description,amount_paise,category_id,payment_method_id,account_id,frequency,anchor_day,next_date,enabled) VALUES(?,?,?,?,?,?,?,?,?)`, x.Description, x.AmountPaise, x.CategoryID, x.PaymentMethodID, x.AccountID, x.Frequency, x.AnchorDay, x.NextDate, boolInt(x.Enabled))
		if err != nil {
			writeError(w, 400, "Invalid recurring expense")
			return
		}
		id, _ := res.LastInsertId()
		writeJSON(w, 201, map[string]any{"id": id})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (a *App) handleRecurringByID(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/api/recurring/"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, 400, "Invalid ID")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var x recurringInput
		if !decodeJSON(w, r, &x, a.cfg.MaxBodyBytes) {
			return
		}
		if !a.validateRecurring(&x) {
			writeError(w, 400, "Invalid recurring expense")
			return
		}
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		_, err := a.db.Exec(`UPDATE recurring_expenses SET description=?,amount_paise=?,category_id=?,payment_method_id=?,account_id=?,frequency=?,anchor_day=?,next_date=?,enabled=?,updated_at=datetime('now') WHERE id=?`, x.Description, x.AmountPaise, x.CategoryID, x.PaymentMethodID, x.AccountID, x.Frequency, x.AnchorDay, x.NextDate, boolInt(x.Enabled), id)
		if err != nil {
			writeError(w, 400, "Could not update recurring expense")
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	case http.MethodDelete:
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		_, err := a.db.Exec(`DELETE FROM recurring_expenses WHERE id=?`, id)
		if err != nil {
			writeError(w, 500, "Could not delete recurring expense")
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (a *App) processRecurring(until string) (int, error) {
	if !validateDate(until) {
		return 0, nil
	}
	a.writeMu.Lock()
	defer a.writeMu.Unlock()
	rows, err := a.db.Query(`SELECT id,description,amount_paise,category_id,payment_method_id,account_id,frequency,anchor_day,next_date FROM recurring_expenses WHERE enabled=1 AND next_date<=? ORDER BY next_date`, until)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	type item struct {
		id, amount, cat, pay int64
		desc, freq, next     string
		account              sql.NullInt64
		anchor               int
	}
	var items []item
	for rows.Next() {
		var x item
		if err := rows.Scan(&x.id, &x.desc, &x.amount, &x.cat, &x.pay, &x.account, &x.freq, &x.anchor, &x.next); err != nil {
			return 0, err
		}
		items = append(items, x)
	}
	count := 0
	for _, x := range items {
		next := x.next
		for next <= until {
			var aid *int64
			if x.account.Valid {
				v := x.account.Int64
				aid = &v
			}
			in := TransactionInput{AmountPaise: x.amount, Description: x.desc, CategoryID: x.cat, PaymentMethodID: x.pay, AccountID: aid, TransactionDate: next, Source: "recurring", RawInput: "recurring:" + strconv.FormatInt(x.id, 10)}
			fp := fingerprint(in)
			var n int
			_ = a.db.QueryRow(`SELECT COUNT(1) FROM transactions WHERE fingerprint=?`, fp).Scan(&n)
			if n == 0 {
				if _, err := a.db.Exec(`INSERT INTO transactions(amount_paise,description,category_id,payment_method_id,account_id,transaction_date,notes,raw_input,source,ai_processed,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,0,?)`, in.AmountPaise, in.Description, in.CategoryID, in.PaymentMethodID, in.AccountID, in.TransactionDate, "", in.RawInput, in.Source, fp); err != nil {
					return count, err
				}
				count++
			}
			newNext, err := nextRecurringDate(next, x.freq, x.anchor)
			if err != nil {
				return count, err
			}
			if newNext == next {
				break
			}
			next = newNext
		}
		_, err := a.db.Exec(`UPDATE recurring_expenses SET next_date=?,last_generated_date=?,updated_at=datetime('now') WHERE id=?`, next, until, x.id)
		if err != nil {
			return count, err
		}
	}
	return count, nil
}

func (a *App) handleRecurringProcess(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Until string `json:"until"`
	}
	if !decodeJSON(w, r, &req, a.cfg.MaxBodyBytes) {
		return
	}
	if !validateDate(req.Until) {
		req.Until = todayFromHeader(r)
	}
	n, err := a.processRecurring(req.Until)
	if err != nil {
		writeError(w, 500, "Could not process recurring expenses")
		return
	}
	writeJSON(w, 200, map[string]any{"created": n})
}
