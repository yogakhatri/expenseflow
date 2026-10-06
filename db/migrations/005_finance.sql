CREATE TABLE IF NOT EXISTS income_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
  source TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id),
  income_date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_income_date ON income_entries(income_date DESC);

CREATE TABLE IF NOT EXISTS monthly_budgets (
  month_key TEXT PRIMARY KEY,
  expected_income_paise INTEGER NOT NULL DEFAULT 0 CHECK(expected_income_paise >= 0),
  spending_limit_paise INTEGER NOT NULL DEFAULT 0 CHECK(spending_limit_paise >= 0),
  savings_target_paise INTEGER NOT NULL DEFAULT 0 CHECK(savings_target_paise >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS category_budgets (
  month_key TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  limit_paise INTEGER NOT NULL CHECK(limit_paise >= 0),
  PRIMARY KEY(month_key, category_id)
);
CREATE INDEX IF NOT EXISTS idx_category_budgets_month ON category_budgets(month_key);
