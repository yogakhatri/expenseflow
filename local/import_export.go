package main

import (
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"strings"
)

func csvSafe(s string) string {
	trim := strings.TrimLeft(s, " \t")
	if trim != "" && strings.ContainsRune("=+-@", rune(trim[0])) {
		return "'" + s
	}
	return s
}

func (a *App) handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="expenseflow.csv"`)
	cw := csv.NewWriter(w)
	defer cw.Flush()
	_ = cw.Write([]string{"Date", "Amount", "Description", "Category", "Payment", "Account", "Notes"})
	rows, err := a.db.Query(`SELECT t.transaction_date,t.amount_paise,t.description,c.name,p.name,COALESCE(a.name,''),t.notes FROM transactions t JOIN categories c ON c.id=t.category_id JOIN payment_methods p ON p.id=t.payment_method_id LEFT JOIN accounts a ON a.id=t.account_id ORDER BY t.transaction_date,t.id`)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var date, desc, cat, pay, acct, notes string
		var paise int64
		if rows.Scan(&date, &paise, &desc, &cat, &pay, &acct, &notes) == nil {
			_ = cw.Write([]string{date, formatPaiseDecimal(paise), csvSafe(desc), csvSafe(cat), csvSafe(pay), csvSafe(acct), csvSafe(notes)})
		}
	}
}

func (a *App) handleImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		writeError(w, 413, "Import file is too large or invalid")
		return
	}
	f, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, 400, "CSV file is required")
		return
	}
	defer f.Close()
	reader := csv.NewReader(io.LimitReader(f, 2<<20))
	reader.FieldsPerRecord = -1
	records, err := reader.ReadAll()
	if err != nil {
		writeError(w, 400, "Invalid CSV")
		return
	}
	if len(records) < 2 {
		writeError(w, 400, "CSV has no data")
		return
	}
	header := map[string]int{}
	for i, h := range records[0] {
		header[normalize(h)] = i
	}
	required := []string{"date", "amount", "description", "category", "payment"}
	for _, x := range required {
		if _, ok := header[x]; !ok {
			writeError(w, 400, "Missing CSV column: "+x)
			return
		}
	}
	cats, _ := a.lookupNames("categories")
	pays, _ := a.lookupNames("payment_methods")
	accounts, _ := a.lookupNames("accounts")
	other := cats["other"]
	cash := pays["cash"]
	var defaultAcct *int64
	if x := accounts["cash"]; x > 0 {
		defaultAcct = &x
	}
	items := []TransactionInput{}
	warnings := []string{}
	for i, row := range records[1:] {
		get := func(name string) string {
			idx, ok := header[name]
			if !ok || idx >= len(row) {
				return ""
			}
			return strings.TrimSpace(row[idx])
		}
		paise, er := parseAmountPaise(get("amount"))
		if er != nil || paise <= 0 {
			warnings = append(warnings, fmt.Sprintf("Row %d invalid amount", i+2))
			continue
		}
		date := get("date")
		if !validateDate(date) {
			warnings = append(warnings, fmt.Sprintf("Row %d invalid date", i+2))
			continue
		}
		cat := cats[normalize(get("category"))]
		if cat == 0 {
			cat = other
			warnings = append(warnings, fmt.Sprintf("Row %d unknown category; set to Other", i+2))
		}
		pay := pays[normalizePaymentAlias(get("payment"))]
		if pay == 0 {
			pay = cash
			warnings = append(warnings, fmt.Sprintf("Row %d unknown payment; set to Cash", i+2))
		}
		acct := defaultAcct
		if s := get("account"); s != "" {
			if id := accounts[normalize(s)]; id > 0 {
				v := id
				acct = &v
			}
		}
		items = append(items, TransactionInput{AmountPaise: paise, Description: get("description"), CategoryID: cat, PaymentMethodID: pay, AccountID: acct, TransactionDate: date, Notes: get("notes"), RawInput: strings.Join(row, ","), Source: "csv"})
	}
	writeJSON(w, 200, map[string]any{"items": items, "warnings": warnings, "preview_only": true})
}
