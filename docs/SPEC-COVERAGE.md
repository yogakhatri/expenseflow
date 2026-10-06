# Specification coverage

## Implemented in local mode

- Go `net/http` single process and direct `database/sql` SQLite.
- WAL, foreign keys, busy timeout and integer-paise storage.
- Schema migrations and seeded settings/lookups.
- Comma parser and shared editable preview model.
- Transaction CRUD, bulk create/delete, optimistic version update.
- Duplicate detection against stored rows and inside bulk input.
- Categories/payment methods/accounts with reference-safe delete behavior.
- Dashboard stats and native Canvas charts.
- Search, category, payment, account, date and amount filters.
- Favorites, rules, pending inbox and recurring expenses.
- Month-end recurring anchor preservation.
- Settings, hash routing/start page and theme support.
- PWA shell cache; sensitive/API responses excluded.
- CSV import preview and CSV-injection-safe export.
- SQLite-safe backup, retention and safety-first restore.
- Optional Ollama adapter with AI-disabled endpoint enforcement.
- AI endpoint restricted to approved local/Docker hosts unless configured by the operator.
- Security headers, same-origin mutation checks and request limits.
- Docker, Tailscale docs, CI/security workflows and release checklist.

## Cloud adapter

The Cloudflare Worker/D1 adapter uses the same frontend and provides transaction CRUD/bulk operations, filters, stats, settings, categories, payment methods, accounts, favorites, rules, recurring expenses, pending entries, deterministic parsing and CSV import/export. Cloud mode intentionally excludes local SQLite backup/restore and the local Ollama adapter. Cloud mode uses built-in single-user Worker authentication; Cloudflare Access is optional defense-in-depth.

## Deliberately deferred / non-goals

Bank sync, UPI scraping, receipt OCR, tax/bookkeeping, investment portfolio, centralized SaaS, family permissions, plugin marketplace, GraphQL and microservices.

## 0.2 finance/UI extension

The implementation additionally includes responsive desktop navigation, income entries, monthly budgets, savings targets, category budgets, free-to-spend calculations, improved charts, compact bulk review, and enhanced transaction filtering.
