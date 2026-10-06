package main

import (
	"database/sql"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

var monthKeyPattern = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)

type incomeInput struct {
	AmountPaise int64  `json:"amount_paise"`
	Source      string `json:"source"`
	AccountID   *int64 `json:"account_id"`
	IncomeDate  string `json:"income_date"`
	Notes       string `json:"notes"`
	Version     int64  `json:"version,omitempty"`
}

func validMonthKey(v string) bool { return monthKeyPattern.MatchString(v) }

func (a *App) validateIncome(x *incomeInput) string {
	x.Source = strings.TrimSpace(x.Source)
	x.Notes = strings.TrimSpace(x.Notes)
	if x.AmountPaise <= 0 || x.AmountPaise > 100_000_000_00 {
		return "Invalid income amount"
	}
	if x.Source == "" || len(x.Source) > 120 {
		return "Income source must be 1-120 characters"
	}
	if len(x.Notes) > 2000 {
		return "Notes must be 2000 characters or less"
	}
	if !validateDate(x.IncomeDate) {
		return "Invalid income date"
	}
	if x.AccountID != nil {
		if ok, _ := a.idExists("accounts", *x.AccountID); !ok {
			return "Invalid account"
		}
	}
	return ""
}

func (a *App) handleIncome(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		month := r.URL.Query().Get("month")
		where := "1=1"
		args := []any{}
		if month != "" {
			if !validMonthKey(month) {
				writeError(w, 400, "Invalid month")
				return
			}
			where = "substr(i.income_date,1,7)=?"
			args = append(args, month)
		}
		rows, err := a.db.Query(`SELECT i.id,i.amount_paise,i.source,i.account_id,COALESCE(a.name,''),i.income_date,i.notes,i.version,i.created_at,i.updated_at
            FROM income_entries i LEFT JOIN accounts a ON a.id=i.account_id WHERE `+where+` ORDER BY i.income_date DESC,i.id DESC`, args...)
		if err != nil {
			writeError(w, 500, "Could not load income")
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		var total int64
		for rows.Next() {
			var id, amount, version int64
			var source, account, date, notes, created, updated string
			var accountID sql.NullInt64
			if rows.Scan(&id, &amount, &source, &accountID, &account, &date, &notes, &version, &created, &updated) != nil {
				continue
			}
			var aid any = nil
			if accountID.Valid {
				aid = accountID.Int64
			}
			total += amount
			items = append(items, map[string]any{"id": id, "amount_paise": amount, "source": source, "account_id": aid, "account_name": account, "income_date": date, "notes": notes, "version": version, "created_at": created, "updated_at": updated})
		}
		writeJSON(w, 200, map[string]any{"items": items, "total_paise": total})
	case http.MethodPost:
		var x incomeInput
		if !decodeJSON(w, r, &x, a.cfg.MaxBodyBytes) {
			return
		}
		if msg := a.validateIncome(&x); msg != "" {
			writeError(w, 400, msg)
			return
		}
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		res, err := a.db.Exec(`INSERT INTO income_entries(amount_paise,source,account_id,income_date,notes) VALUES(?,?,?,?,?)`, x.AmountPaise, x.Source, x.AccountID, x.IncomeDate, x.Notes)
		if err != nil {
			writeError(w, 500, "Could not save income")
			return
		}
		id, _ := res.LastInsertId()
		writeJSON(w, 201, map[string]any{"id": id})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (a *App) handleIncomeByID(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/api/income/"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, 400, "Invalid income ID")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var x incomeInput
		if !decodeJSON(w, r, &x, a.cfg.MaxBodyBytes) {
			return
		}
		if x.Version <= 0 {
			writeError(w, 400, "version is required")
			return
		}
		if msg := a.validateIncome(&x); msg != "" {
			writeError(w, 400, msg)
			return
		}
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		res, err := a.db.Exec(`UPDATE income_entries SET amount_paise=?,source=?,account_id=?,income_date=?,notes=?,version=version+1,updated_at=datetime('now') WHERE id=? AND version=?`, x.AmountPaise, x.Source, x.AccountID, x.IncomeDate, x.Notes, id, x.Version)
		if err != nil {
			writeError(w, 500, "Could not update income")
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeError(w, 409, "Income changed elsewhere; refresh and retry")
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	case http.MethodDelete:
		a.writeMu.Lock()
		defer a.writeMu.Unlock()
		res, err := a.db.Exec(`DELETE FROM income_entries WHERE id=?`, id)
		if err != nil {
			writeError(w, 500, "Could not delete income")
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeError(w, 404, "Income not found")
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (a *App) handleBudget(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		month := r.URL.Query().Get("month")
		if !validMonthKey(month) {
			writeError(w, 400, "Invalid month")
			return
		}
		var expected, limit, savings int64
		_ = a.db.QueryRow(`SELECT expected_income_paise,spending_limit_paise,savings_target_paise FROM monthly_budgets WHERE month_key=?`, month).Scan(&expected, &limit, &savings)
		rows, err := a.db.Query(`SELECT c.id,c.name,COALESCE(cb.limit_paise,0),COALESCE(SUM(t.amount_paise),0)
            FROM categories c LEFT JOIN category_budgets cb ON cb.category_id=c.id AND cb.month_key=?
            LEFT JOIN transactions t ON t.category_id=c.id AND substr(t.transaction_date,1,7)=?
            WHERE c.enabled=1 GROUP BY c.id ORDER BY c.name`, month, month)
		if err != nil {
			writeError(w, 500, "Could not load budget")
			return
		}
		defer rows.Close()
		cats := []map[string]any{}
		for rows.Next() {
			var id, catLimit, spent int64
			var name string
			if rows.Scan(&id, &name, &catLimit, &spent) == nil {
				cats = append(cats, map[string]any{"category_id": id, "category_name": name, "limit_paise": catLimit, "spent_paise": spent})
			}
		}
		writeJSON(w, 200, map[string]any{"month": month, "expected_income_paise": expected, "spending_limit_paise": limit, "savings_target_paise": savings, "categories": cats})
		return
	}
	if r.Method != http.MethodPut {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Month               string `json:"month"`
		ExpectedIncomePaise int64  `json:"expected_income_paise"`
		SpendingLimitPaise  int64  `json:"spending_limit_paise"`
		SavingsTargetPaise  int64  `json:"savings_target_paise"`
		Categories          []struct {
			CategoryID int64 `json:"category_id"`
			LimitPaise int64 `json:"limit_paise"`
		} `json:"categories"`
	}
	if !decodeJSON(w, r, &req, a.cfg.MaxBodyBytes) {
		return
	}
	if !validMonthKey(req.Month) || req.ExpectedIncomePaise < 0 || req.SpendingLimitPaise < 0 || req.SavingsTargetPaise < 0 {
		writeError(w, 400, "Invalid budget")
		return
	}
	if len(req.Categories) > 200 {
		writeError(w, 400, "Too many category budgets")
		return
	}
	a.writeMu.Lock()
	defer a.writeMu.Unlock()
	tx, err := a.db.Begin()
	if err != nil {
		writeError(w, 500, "Could not save budget")
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`INSERT INTO monthly_budgets(month_key,expected_income_paise,spending_limit_paise,savings_target_paise) VALUES(?,?,?,?)
        ON CONFLICT(month_key) DO UPDATE SET expected_income_paise=excluded.expected_income_paise,spending_limit_paise=excluded.spending_limit_paise,savings_target_paise=excluded.savings_target_paise,updated_at=datetime('now')`, req.Month, req.ExpectedIncomePaise, req.SpendingLimitPaise, req.SavingsTargetPaise); err != nil {
		writeError(w, 500, "Could not save budget")
		return
	}
	if _, err = tx.Exec(`DELETE FROM category_budgets WHERE month_key=?`, req.Month); err != nil {
		writeError(w, 500, "Could not save category budgets")
		return
	}
	for _, c := range req.Categories {
		if c.LimitPaise <= 0 {
			continue
		}
		if c.CategoryID <= 0 || c.LimitPaise < 0 {
			writeError(w, 400, "Invalid category budget")
			return
		}
		if _, err = tx.Exec(`INSERT INTO category_budgets(month_key,category_id,limit_paise) VALUES(?,?,?)`, req.Month, c.CategoryID, c.LimitPaise); err != nil {
			writeError(w, 400, "Invalid category budget")
			return
		}
	}
	if err = tx.Commit(); err != nil {
		writeError(w, 500, "Could not save budget")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
