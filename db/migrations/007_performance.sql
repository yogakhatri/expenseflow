CREATE INDEX IF NOT EXISTS idx_transactions_date_category ON transactions(transaction_date, category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date_payment ON transactions(transaction_date, payment_method_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date_account ON transactions(transaction_date, account_id);
CREATE INDEX IF NOT EXISTS idx_recurring_due ON recurring_expenses(enabled, next_date);
