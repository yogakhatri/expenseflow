CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  icon TEXT NOT NULL DEFAULT 'tag',
  color TEXT NOT NULL DEFAULT '#64748b',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
  description TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  payment_method_id INTEGER NOT NULL REFERENCES payment_methods(id),
  account_id INTEGER REFERENCES accounts(id),
  transaction_date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  raw_input TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  ai_confidence REAL,
  ai_model TEXT,
  ai_processed INTEGER NOT NULL DEFAULT 0 CHECK(ai_processed IN (0,1)),
  fingerprint TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_payment ON transactions(payment_method_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_fingerprint ON transactions(fingerprint);
CREATE INDEX IF NOT EXISTS idx_transactions_date_category ON transactions(transaction_date, category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date_payment ON transactions(transaction_date, payment_method_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date_account ON transactions(transaction_date, account_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pending_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK(status IN ('RAW','PARSED','REVIEW_NEEDED','SAVED')),
  raw_input TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  payment_method_id INTEGER REFERENCES payment_methods(id),
  account_id INTEGER REFERENCES accounts(id),
  amount_paise INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categorization_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  merchant TEXT NOT NULL DEFAULT '',
  category_id INTEGER NOT NULL REFERENCES categories(id),
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  payment_method_id INTEGER NOT NULL REFERENCES payment_methods(id),
  account_id INTEGER REFERENCES accounts(id),
  frequency TEXT NOT NULL CHECK(frequency IN ('weekly','monthly','yearly')),
  anchor_day INTEGER,
  next_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  last_generated_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recurring_due ON recurring_expenses(enabled, next_date);

INSERT OR IGNORE INTO settings(key,value) VALUES
('start_page','dashboard'),
('theme','system'),
('compact_rows','false'),
('ai_enabled','false'),
('ai_url','http://127.0.0.1:11434'),
('ai_model','qwen3.5:4b'),
('ai_unload','false'),
('backup_schedule','off'),
('backup_retention_daily','7'),
('backup_retention_weekly','4');

INSERT OR IGNORE INTO categories(name,icon,color) VALUES
('Food','utensils','#f97316'),('Groceries','basket','#84cc16'),('Fuel','fuel','#ef4444'),
('Transport','car','#3b82f6'),('Housing','home','#8b5cf6'),('Utilities','zap','#06b6d4'),
('Medical','heart','#ec4899'),('Shopping','bag','#a855f7'),('Electronics','cpu','#6366f1'),
('Education','book','#14b8a6'),('Entertainment','play','#eab308'),('Travel','plane','#0ea5e9'),
('Personal','user','#64748b'),('Other','tag','#64748b');

INSERT OR IGNORE INTO payment_methods(name) VALUES
('Cash'),('UPI'),('Debit Card'),('Credit Card'),('Bank Transfer'),('Other');

INSERT OR IGNORE INTO accounts(name) VALUES ('Cash');
