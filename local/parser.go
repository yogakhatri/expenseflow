package main

import (
	"bufio"
	"fmt"
	"strings"
	"time"
)

func (a *App) parseComma(text, localDate string) ([]PreviewItem, error) {
	if strings.TrimSpace(text) == "" {
		return nil, fmt.Errorf("input is empty")
	}
	cats, err := a.lookupNames("categories")
	if err != nil {
		return nil, err
	}
	pays, err := a.lookupNames("payment_methods")
	if err != nil {
		return nil, err
	}
	accounts, err := a.lookupNames("accounts")
	if err != nil {
		return nil, err
	}
	otherID := cats["other"]
	defaultPay := pays["cash"]
	var defaultAccount *int64
	if id := accounts["cash"]; id > 0 {
		defaultAccount = &id
	}

	var out []PreviewItem
	s := bufio.NewScanner(strings.NewReader(text))
	s.Buffer(make([]byte, 1024), 128*1024)
	lineNo := 0
	for s.Scan() {
		lineNo++
		line := strings.TrimSpace(s.Text())
		if line == "" {
			continue
		}
		parts := strings.Split(line, ",")
		if len(parts) < 3 || len(parts) > 5 {
			return nil, fmt.Errorf("line %d must be amount, description, payment[, date, category]", lineNo)
		}
		paise, err := parseAmountPaise(parts[0])
		if err != nil || paise <= 0 {
			return nil, fmt.Errorf("line %d has invalid amount", lineNo)
		}
		desc := strings.TrimSpace(parts[1])
		if desc == "" {
			return nil, fmt.Errorf("line %d has empty description", lineNo)
		}
		payName := strings.ToLower(strings.TrimSpace(parts[2]))
		payName = normalizePaymentAlias(payName)
		payID := pays[payName]
		needsReview := false
		warning := ""
		if payID == 0 {
			payID = defaultPay
			needsReview = true
			warning = "Unknown payment method; defaulted to Cash"
		}
		date := localDate
		if len(parts) >= 4 && strings.TrimSpace(parts[3]) != "" {
			date = strings.TrimSpace(parts[3])
			if !validateDate(date) {
				return nil, fmt.Errorf("line %d has invalid date", lineNo)
			}
		}
		catID := otherID
		catName := "Other"
		if len(parts) == 5 && strings.TrimSpace(parts[4]) != "" {
			name := normalize(strings.TrimSpace(parts[4]))
			if id := cats[name]; id > 0 {
				catID, catName = id, titleName(name)
			} else {
				needsReview = true
				warning = strings.TrimSpace(warning + "; Unknown category; defaulted to Other")
			}
		} else if id, name := a.categoryFromRules(desc); id > 0 {
			catID, catName = id, name
		}
		out = append(out, PreviewItem{
			AmountPaise: paise, Description: desc, CategoryID: catID, CategoryName: catName,
			PaymentMethodID: payID, PaymentName: lookupDisplay(pays, payID), AccountID: defaultAccount,
			TransactionDate: date, RawInput: line, Source: "comma", NeedsReview: needsReview, Warning: strings.Trim(warning, "; "),
		})
	}
	if err := s.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no transactions found")
	}
	return out, nil
}

func normalizePaymentAlias(s string) string {
	s = normalize(s)
	switch s {
	case "card", "credit", "creditcard", "credit card":
		return "credit card"
	case "debit", "debitcard", "debit card":
		return "debit card"
	case "bank", "transfer", "bank transfer":
		return "bank transfer"
	default:
		return s
	}
}

func titleName(s string) string {
	words := strings.Fields(s)
	for i := range words {
		if len(words[i]) > 0 {
			words[i] = strings.ToUpper(words[i][:1]) + words[i][1:]
		}
	}
	return strings.Join(words, " ")
}

func lookupDisplay(m map[string]int64, id int64) string {
	for name, v := range m {
		if v == id {
			return titleName(name)
		}
	}
	return ""
}

func (a *App) lookupNames(table string) (map[string]int64, error) {
	allowed := map[string]bool{"categories": true, "payment_methods": true, "accounts": true}
	if !allowed[table] {
		return nil, fmt.Errorf("invalid lookup")
	}
	rows, err := a.db.Query("SELECT id,name FROM " + table + " WHERE enabled=1")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[normalize(name)] = id
	}
	return out, rows.Err()
}

func (a *App) categoryFromRules(desc string) (int64, string) {
	rows, err := a.db.Query(`SELECT r.category_id,c.name,r.keyword,r.merchant FROM categorization_rules r JOIN categories c ON c.id=r.category_id WHERE r.enabled=1 ORDER BY r.priority ASC,r.id ASC`)
	if err != nil {
		return 0, ""
	}
	defer rows.Close()
	d := normalize(desc)
	for rows.Next() {
		var id int64
		var name, keyword, merchant string
		if rows.Scan(&id, &name, &keyword, &merchant) == nil {
			if keyword != "" && strings.Contains(d, normalize(keyword)) {
				return id, name
			}
			if merchant != "" && strings.Contains(d, normalize(merchant)) {
				return id, name
			}
		}
	}
	return 0, ""
}

func nextRecurringDate(current string, frequency string, anchorDay int) (string, error) {
	d, err := time.Parse("2006-01-02", current)
	if err != nil {
		return "", err
	}
	switch frequency {
	case "weekly":
		return d.AddDate(0, 0, 7).Format("2006-01-02"), nil
	case "yearly":
		y := d.Year() + 1
		m := d.Month()
		day := anchorDay
		if day <= 0 {
			day = d.Day()
		}
		return dateWithClampedDay(y, m, day).Format("2006-01-02"), nil
	case "monthly":
		y, m := d.Year(), d.Month()+1
		if m > 12 {
			m = 1
			y++
		}
		day := anchorDay
		if day <= 0 {
			day = d.Day()
		}
		return dateWithClampedDay(y, m, day).Format("2006-01-02"), nil
	default:
		return "", fmt.Errorf("invalid recurrence")
	}
}

func dateWithClampedDay(y int, m time.Month, day int) time.Time {
	last := time.Date(y, m+1, 0, 0, 0, 0, 0, time.UTC).Day()
	if day > last {
		day = last
	}
	if day < 1 {
		day = 1
	}
	return time.Date(y, m, day, 0, 0, 0, 0, time.UTC)
}
