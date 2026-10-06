CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_payment ON transactions(payment_method_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date_category ON transactions(transaction_date, category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date_payment ON transactions(transaction_date, payment_method_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date_account ON transactions(transaction_date, account_id);
CREATE INDEX IF NOT EXISTS idx_recurring_due ON recurring_expenses(enabled, next_date);
INSERT OR IGNORE INTO schema_version(version) VALUES (7);
