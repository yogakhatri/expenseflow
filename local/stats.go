package main

import (
	"net/http"
	"time"
)

func nonNegative(v int64) int64 {
	if v < 0 {
		return 0
	}
	return v
}
func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func (a *App) upcomingRecurringTotal(afterDate, monthEnd string) int64 {
	rows, err := a.db.Query(`SELECT amount_paise,frequency,anchor_day,next_date FROM recurring_expenses WHERE enabled=1 AND next_date<=?`, monthEnd)
	if err != nil {
		return 0
	}
	defer rows.Close()
	var total int64
	for rows.Next() {
		var amount int64
		var frequency, next string
		var anchor int
		if rows.Scan(&amount, &frequency, &anchor, &next) != nil {
			continue
		}
		for next <= monthEnd {
			if next > afterDate {
				total += amount
			}
			n, err := nextRecurringDate(next, frequency, anchor)
			if err != nil || n == next {
				break
			}
			next = n
		}
	}
	return total
}

func (a *App) handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	localDate := r.URL.Query().Get("date")
	if !validateDate(localDate) {
		localDate = todayFromHeader(r)
	}
	d, _ := time.Parse("2006-01-02", localDate)
	monthStartDate := time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, time.UTC)
	nextMonthDate := monthStartDate.AddDate(0, 1, 0)
	prevMonthDate := monthStartDate.AddDate(0, -1, 0)
	monthStart := monthStartDate.Format("2006-01-02")
	nextMonth := nextMonthDate.Format("2006-01-02")
	prevMonth := prevMonthDate.Format("2006-01-02")
	monthKey := monthStart[:7]
	monthEnd := nextMonthDate.AddDate(0, 0, -1).Format("2006-01-02")

	var monthTotal, todayTotal, count, prevTotal int64
	_ = a.db.QueryRow(`SELECT COALESCE(SUM(amount_paise),0),COUNT(*) FROM transactions WHERE transaction_date>=? AND transaction_date<?`, monthStart, nextMonth).Scan(&monthTotal, &count)
	_ = a.db.QueryRow(`SELECT COALESCE(SUM(amount_paise),0) FROM transactions WHERE transaction_date=?`, localDate).Scan(&todayTotal)
	_ = a.db.QueryRow(`SELECT COALESCE(SUM(amount_paise),0) FROM transactions WHERE transaction_date>=? AND transaction_date<?`, prevMonth, monthStart).Scan(&prevTotal)
	var incomeTotal int64
	_ = a.db.QueryRow(`SELECT COALESCE(SUM(amount_paise),0) FROM income_entries WHERE income_date>=? AND income_date<?`, monthStart, nextMonth).Scan(&incomeTotal)

	var expectedIncome, spendingLimit, savingsTarget int64
	_ = a.db.QueryRow(`SELECT expected_income_paise,spending_limit_paise,savings_target_paise FROM monthly_budgets WHERE month_key=?`, monthKey).Scan(&expectedIncome, &spendingLimit, &savingsTarget)
	upcoming := a.upcomingRecurringTotal(localDate, monthEnd)
	netSavings := incomeTotal - monthTotal
	savingsGap := nonNegative(savingsTarget - netSavings)
	cashAfterPlan := nonNegative(incomeTotal - monthTotal - savingsTarget - upcoming)
	freeToSpend := cashAfterPlan
	var budgetRemaining any = nil
	if spendingLimit > 0 {
		br := nonNegative(spendingLimit - monthTotal)
		budgetRemaining = br
		freeToSpend = min64(freeToSpend, nonNegative(br-upcoming))
	}
	daysElapsed := d.Day()
	if daysElapsed < 1 {
		daysElapsed = 1
	}
	daysInMonth := nextMonthDate.AddDate(0, 0, -1).Day()
	daysRemaining := daysInMonth - d.Day() + 1
	if daysRemaining < 0 {
		daysRemaining = 0
	}
	dailyAvg := monthTotal / int64(daysElapsed)
	projected := dailyAvg * int64(daysInMonth)
	dailySafe := int64(0)
	if daysRemaining > 0 {
		dailySafe = freeToSpend / int64(daysRemaining)
	}

	var topCategory string
	var topCategoryTotal int64
	_ = a.db.QueryRow(`SELECT c.name,COALESCE(SUM(t.amount_paise),0) total FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.transaction_date>=? AND t.transaction_date<? GROUP BY c.id ORDER BY total DESC LIMIT 1`, monthStart, nextMonth).Scan(&topCategory, &topCategoryTotal)
	var largestDesc string
	var largestAmount int64
	_ = a.db.QueryRow(`SELECT description,amount_paise FROM transactions WHERE transaction_date>=? AND transaction_date<? ORDER BY amount_paise DESC LIMIT 1`, monthStart, nextMonth).Scan(&largestDesc, &largestAmount)

	daily := []map[string]any{}
	rows, _ := a.db.Query(`SELECT transaction_date,SUM(amount_paise) FROM transactions WHERE transaction_date>=? AND transaction_date<? GROUP BY transaction_date ORDER BY transaction_date`, monthStart, nextMonth)
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var date string
			var total int64
			if rows.Scan(&date, &total) == nil {
				daily = append(daily, map[string]any{"date": date, "total_paise": total})
			}
		}
	}
	cats := []map[string]any{}
	rows2, _ := a.db.Query(`SELECT c.id,c.name,SUM(t.amount_paise) total,COALESCE(cb.limit_paise,0) budget FROM transactions t JOIN categories c ON c.id=t.category_id LEFT JOIN category_budgets cb ON cb.category_id=c.id AND cb.month_key=? WHERE t.transaction_date>=? AND t.transaction_date<? GROUP BY c.id ORDER BY total DESC`, monthKey, monthStart, nextMonth)
	if rows2 != nil {
		defer rows2.Close()
		for rows2.Next() {
			var id, total, budget int64
			var name string
			if rows2.Scan(&id, &name, &total, &budget) == nil {
				cats = append(cats, map[string]any{"id": id, "name": name, "total_paise": total, "budget_paise": budget})
			}
		}
	}
	pays := []map[string]any{}
	rows3, _ := a.db.Query(`SELECT p.name,SUM(t.amount_paise) total FROM transactions t JOIN payment_methods p ON p.id=t.payment_method_id WHERE t.transaction_date>=? AND t.transaction_date<? GROUP BY p.id ORDER BY total DESC`, monthStart, nextMonth)
	if rows3 != nil {
		defer rows3.Close()
		for rows3.Next() {
			var name string
			var total int64
			if rows3.Scan(&name, &total) == nil {
				pays = append(pays, map[string]any{"name": name, "total_paise": total})
			}
		}
	}

	firstCashflowMonth := monthStartDate.AddDate(0, -5, 0)
	expenseByMonth := map[string]int64{}
	incomeByMonth := map[string]int64{}
	if rows, err := a.db.Query(`SELECT substr(transaction_date,1,7),SUM(amount_paise) FROM transactions WHERE transaction_date>=? AND transaction_date<? GROUP BY substr(transaction_date,1,7)`, firstCashflowMonth.Format("2006-01-02"), nextMonth); err == nil {
		defer rows.Close()
		for rows.Next() {
			var month string
			var total int64
			if rows.Scan(&month, &total) == nil {
				expenseByMonth[month] = total
			}
		}
	}
	if rows, err := a.db.Query(`SELECT substr(income_date,1,7),SUM(amount_paise) FROM income_entries WHERE income_date>=? AND income_date<? GROUP BY substr(income_date,1,7)`, firstCashflowMonth.Format("2006-01-02"), nextMonth); err == nil {
		defer rows.Close()
		for rows.Next() {
			var month string
			var total int64
			if rows.Scan(&month, &total) == nil {
				incomeByMonth[month] = total
			}
		}
	}

	cashflow := []map[string]any{}
	for i := 5; i >= 0; i-- {
		start := monthStartDate.AddDate(0, -i, 0)
		month := start.Format("2006-01")
		expense := expenseByMonth[month]
		income := incomeByMonth[month]
		cashflow = append(cashflow, map[string]any{"month": month, "name": start.Format("Jan"), "income_paise": income, "expense_paise": expense, "net_paise": income - expense})
	}

	categoryBudgets := []map[string]any{}
	rows4, _ := a.db.Query(`SELECT c.id,c.name,cb.limit_paise,COALESCE(SUM(t.amount_paise),0) spent
      FROM category_budgets cb JOIN categories c ON c.id=cb.category_id LEFT JOIN transactions t ON t.category_id=c.id AND substr(t.transaction_date,1,7)=cb.month_key
      WHERE cb.month_key=? GROUP BY c.id ORDER BY c.name`, monthKey)
	if rows4 != nil {
		defer rows4.Close()
		for rows4.Next() {
			var id, limit, spent int64
			var name string
			if rows4.Scan(&id, &name, &limit, &spent) == nil {
				categoryBudgets = append(categoryBudgets, map[string]any{"category_id": id, "category_name": name, "limit_paise": limit, "spent_paise": spent, "remaining_paise": nonNegative(limit - spent)})
			}
		}
	}

	writeJSON(w, 200, map[string]any{
		"date": localDate, "month": monthKey, "this_month_paise": monthTotal, "today_paise": todayTotal, "daily_average_paise": dailyAvg, "transaction_count": count, "previous_month_paise": prevTotal,
		"income_paise": incomeTotal, "expected_income_paise": expectedIncome, "spending_limit_paise": spendingLimit, "savings_target_paise": savingsTarget, "net_savings_paise": netSavings, "savings_gap_paise": savingsGap,
		"budget_remaining_paise": budgetRemaining, "upcoming_commitments_paise": upcoming, "free_to_spend_paise": freeToSpend, "safe_daily_paise": dailySafe, "days_remaining": daysRemaining, "projected_month_end_paise": projected,
		"top_category": topCategory, "top_category_paise": topCategoryTotal, "largest_expense": largestDesc, "largest_expense_paise": largestAmount,
		"daily": daily, "categories": cats, "payments": pays, "cashflow": cashflow, "category_budgets": categoryBudgets,
	})
}
