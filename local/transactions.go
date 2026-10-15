package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

func (a *App) validateTransaction(in *TransactionInput) error {
	in.Description = strings.TrimSpace(in.Description)
	in.Notes = strings.TrimSpace(in.Notes)
	in.RawInput = strings.TrimSpace(in.RawInput)
	if in.Source == "" {
		in.Source = "manual"
	}
	if in.AmountPaise <= 0 {
		return fmt.Errorf("amount must be greater than zero")
	}
	if in.AmountPaise > 100_000_000_00 {
		return fmt.Errorf("amount is too large")
	}
	if len(in.Description) == 0 || len(in.Description) > 300 {
		return fmt.Errorf("description must be 1-300 characters")
	}
	if len(in.Notes) > 2000 {
		return fmt.Errorf("notes must be 2000 characters or less")
	}
	if len(in.RawInput) > 20_000 {
		return fmt.Errorf("raw input is too long")
	}
	if !validateDate(in.TransactionDate) {
		return fmt.Errorf("invalid transaction date")
	}
	if ok, _ := a.idExists("categories", in.CategoryID); !ok {
		return fmt.Errorf("invalid category")
	}
	if ok, _ := a.idExists("payment_methods", in.PaymentMethodID); !ok {
		return fmt.Errorf("invalid payment method")
	}
	if in.AccountID != nil {
		if ok, _ := a.idExists("accounts", *in.AccountID); !ok {
			return fmt.Errorf("invalid account")
		}
	}
	return nil
}

func (a *App) idExists(table string, id int64) (bool, error) {
	allowed := map[string]bool{"categories": true, "payment_methods": true, "accounts": true}
	if !allowed[table] {
		return false, fmt.Errorf("invalid lookup")
	}
	var n int
	err := a.db.QueryRow("SELECT COUNT(1) FROM "+table+" WHERE id=?", id).Scan(&n)
	return n > 0, err
}

func (a *App) duplicateExists(fp string, excludeID int64) (bool, error) {
	var n int
	if excludeID > 0 {
		err := a.db.QueryRow(`SELECT COUNT(1) FROM transactions WHERE fingerprint=? AND id<>?`, fp, excludeID).Scan(&n)
		return n > 0, err
	}
	err := a.db.QueryRow(`SELECT COUNT(1) FROM transactions WHERE fingerprint=?`, fp).Scan(&n)
	return n > 0, err
}

func (a *App) createTransaction(in TransactionInput) (int64, bool, error) {
	if err := a.validateTransaction(&in); err != nil {
		return 0, false, err
	}
	fp := fingerprint(in)
	dup, err := a.duplicateExists(fp, 0)
	if err != nil {
		return 0, false, err
	}
	if dup {
		return 0, true, nil
	}
	res, err := a.db.Exec(`INSERT INTO transactions(amount_paise,description,category_id,payment_method_id,account_id,transaction_date,notes,raw_input,source,ai_confidence,ai_model,ai_processed,fingerprint)
	VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, in.AmountPaise, in.Description, in.CategoryID, in.PaymentMethodID, in.AccountID, in.TransactionDate, in.Notes, in.RawInput, in.Source, in.AIConfidence, in.AIModel, boolInt(in.AIProcessed), fp)
	if err != nil {
		return 0, false, err
	}
	id, err := res.LastInsertId()
	return id, false, err
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func (a *App) handleTransactions(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		a.listTransactions(w, r)
	case http.MethodPost:
		var in TransactionInput
		if !decodeJSON(w, r, &in, a.cfg.MaxBodyBytes) {
			return
		}
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		id, dup, err := a.createTransaction(in)
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
		if dup {
			writeJSON(w, 409, map[string]any{"duplicate": true, "error": "Possible duplicate transaction"})
			return
		}
		writeJSON(w, 201, map[string]any{"id": id})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (a *App) handleTransactionByID(w http.ResponseWriter, r *http.Request) {
	idText := strings.TrimPrefix(r.URL.Path, "/api/transactions/")
	id, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || id <= 0 {
		writeError(w, 400, "Invalid transaction ID")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var in TransactionInput
		if !decodeJSON(w, r, &in, a.cfg.MaxBodyBytes) {
			return
		}
		if in.Version <= 0 {
			writeError(w, 400, "version is required")
			return
		}
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		if err := a.validateTransaction(&in); err != nil {
			writeError(w, 400, err.Error())
			return
		}
		fp := fingerprint(in)
		if dup, _ := a.duplicateExists(fp, id); dup {
			writeJSON(w, 409, map[string]any{"duplicate": true, "error": "Possible duplicate transaction"})
			return
		}
		res, err := a.db.Exec(`UPDATE transactions SET amount_paise=?,description=?,category_id=?,payment_method_id=?,account_id=?,transaction_date=?,notes=?,raw_input=?,source=?,fingerprint=?,version=version+1,updated_at=datetime('now') WHERE id=? AND version=?`, in.AmountPaise, in.Description, in.CategoryID, in.PaymentMethodID, in.AccountID, in.TransactionDate, in.Notes, in.RawInput, in.Source, fp, id, in.Version)
		if err != nil {
			writeError(w, 500, "Could not update transaction")
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeError(w, 409, "Transaction changed elsewhere; refresh and retry")
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	case http.MethodDelete:
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		res, err := a.db.Exec(`DELETE FROM transactions WHERE id=?`, id)
		if err != nil {
			writeError(w, 500, "Could not delete transaction")
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeError(w, 404, "Transaction not found")
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (a *App) listTransactions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := []string{"1=1"}
	args := []any{}
	if s := strings.TrimSpace(q.Get("search")); s != "" {
		where = append(where, "(t.description LIKE ? OR t.notes LIKE ?)")
		like := "%" + s + "%"
		args = append(args, like, like)
	}
	for _, f := range []struct{ key, col string }{{"category", "t.category_id"}, {"payment", "t.payment_method_id"}, {"account", "t.account_id"}} {
		if v := q.Get(f.key); v != "" {
			if id, err := strconv.ParseInt(v, 10, 64); err == nil {
				where = append(where, f.col+"=?")
				args = append(args, id)
			}
		}
	}
	if v := q.Get("from"); validateDate(v) {
		where = append(where, "t.transaction_date>=?")
		args = append(args, v)
	}
	if v := q.Get("to"); validateDate(v) {
		where = append(where, "t.transaction_date<=?")
		args = append(args, v)
	}
	if v := q.Get("min"); v != "" {
		if n, e := strconv.ParseInt(v, 10, 64); e == nil {
			where = append(where, "t.amount_paise>=?")
			args = append(args, n)
		}
	}
	if v := q.Get("max"); v != "" {
		if n, e := strconv.ParseInt(v, 10, 64); e == nil {
			where = append(where, "t.amount_paise<=?")
			args = append(args, n)
		}
	}
	order := "t.transaction_date DESC,t.id DESC"
	if q.Get("sort") == "amount_desc" {
		order = "t.amount_paise DESC,t.id DESC"
	} else if q.Get("sort") == "amount_asc" {
		order = "t.amount_paise ASC,t.id DESC"
	}
	limit := parseIntQuery(r, "limit", 100)
	if limit < 1 || limit > 500 {
		limit = 100
	}
	offset := parseIntQuery(r, "offset", 0)
	if offset < 0 {
		offset = 0
	}
	query := `SELECT t.id,t.amount_paise,t.description,t.category_id,c.name,t.payment_method_id,p.name,t.account_id,COALESCE(a.name,''),t.transaction_date,t.notes,t.raw_input,t.source,t.ai_confidence,COALESCE(t.ai_model,''),t.ai_processed,t.fingerprint,t.version,t.created_at,t.updated_at
	FROM transactions t JOIN categories c ON c.id=t.category_id JOIN payment_methods p ON p.id=t.payment_method_id LEFT JOIN accounts a ON a.id=t.account_id WHERE ` + strings.Join(where, " AND ") + ` ORDER BY ` + order + ` LIMIT ? OFFSET ?`
	args = append(args, limit, offset)
	rows, err := a.db.Query(query, args...)
	if err != nil {
		writeError(w, 500, "Could not load transactions")
		return
	}
	defer rows.Close()
	items := []Transaction{}
	for rows.Next() {
		var t Transaction
		var account sql.NullInt64
		var conf sql.NullFloat64
		var aiProcessed int
		if err := rows.Scan(&t.ID, &t.AmountPaise, &t.Description, &t.CategoryID, &t.CategoryName, &t.PaymentMethodID, &t.PaymentMethodName, &account, &t.AccountName, &t.TransactionDate, &t.Notes, &t.RawInput, &t.Source, &conf, &t.AIModel, &aiProcessed, &t.Fingerprint, &t.Version, &t.CreatedAt, &t.UpdatedAt); err != nil {
			writeError(w, 500, "Could not load transactions")
			return
		}
		if account.Valid {
			x := account.Int64
			t.AccountID = &x
		}
		if conf.Valid {
			x := conf.Float64
			t.AIConfidence = &x
		}
		t.AIProcessed = aiProcessed == 1
		items = append(items, t)
	}
	writeJSON(w, 200, map[string]any{"items": items, "limit": limit, "offset": offset})
}

func (a *App) handleBulkCreate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Items           []TransactionInput `json:"items"`
		AllowDuplicates bool               `json:"allow_duplicates"`
	}
	if !decodeJSON(w, r, &req, a.cfg.MaxBodyBytes) {
		return
	}
	if len(req.Items) == 0 || len(req.Items) > a.cfg.MaxBulkItems {
		writeError(w, 400, "Invalid bulk item count")
		return
	}
	a.writeMu.Lock()
	defer a.writeMu.Unlock()
	seen := map[string]bool{}
	duplicates := []int{}
	for i := range req.Items {
		if err := a.validateTransaction(&req.Items[i]); err != nil {
			writeError(w, 400, fmt.Sprintf("item %d: %v", i+1, err))
			return
		}
		fp := fingerprint(req.Items[i])
		if seen[fp] {
			duplicates = append(duplicates, i)
		}
		seen[fp] = true
		if dup, _ := a.duplicateExists(fp, 0); dup {
			duplicates = append(duplicates, i)
		}
	}
	if len(duplicates) > 0 && !req.AllowDuplicates {
		writeJSON(w, 409, map[string]any{"duplicate": true, "indexes": duplicates, "error": "Possible duplicate transactions"})
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		writeError(w, 500, "Could not start save")
		return
	}
	defer tx.Rollback()
	ids := []int64{}
	for _, in := range req.Items {
		fp := fingerprint(in)
		res, err := tx.Exec(`INSERT INTO transactions(amount_paise,description,category_id,payment_method_id,account_id,transaction_date,notes,raw_input,source,ai_confidence,ai_model,ai_processed,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, in.AmountPaise, in.Description, in.CategoryID, in.PaymentMethodID, in.AccountID, in.TransactionDate, in.Notes, in.RawInput, in.Source, in.AIConfidence, in.AIModel, boolInt(in.AIProcessed), fp)
		if err != nil {
			writeError(w, 500, "Could not save transactions")
			return
		}
		id, _ := res.LastInsertId()
		ids = append(ids, id)
	}
	if err := tx.Commit(); err != nil {
		writeError(w, 500, "Could not save transactions")
		return
	}
	writeJSON(w, 201, map[string]any{"ids": ids})
}

func (a *App) handleBulkDelete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if !decodeJSON(w, r, &req, a.cfg.MaxBodyBytes) {
		return
	}
	if len(req.IDs) == 0 || len(req.IDs) > a.cfg.MaxBulkItems {
		writeError(w, 400, "Invalid bulk item count")
		return
	}
	a.writeMu.Lock()
	defer a.writeMu.Unlock()
	tx, err := a.db.Begin()
	if err != nil {
		writeError(w, 500, "Could not start delete")
		return
	}
	defer tx.Rollback()
	for _, id := range req.IDs {
		if id <= 0 {
			writeError(w, 400, "Invalid ID")
			return
		}
		if _, err := tx.Exec(`DELETE FROM transactions WHERE id=?`, id); err != nil {
			writeError(w, 500, "Could not delete transactions")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, 500, "Could not delete transactions")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
