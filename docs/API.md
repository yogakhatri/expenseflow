# API

All JSON API responses use `application/json`. Financial/API responses use `Cache-Control: no-store`.

Cloud authentication endpoints:

```text
GET    /api/auth/status
POST   /api/auth/login
POST   /api/auth/logout
```

In cloud mode, every financial API route requires a valid session. `/api/health` and the authentication endpoints remain public. Local mode does not require the cloud login.

Core endpoints:

```text
GET    /api/health
GET    /api/bootstrap
POST   /api/parse
GET    /api/transactions
POST   /api/transactions
POST   /api/transactions/bulk
PUT    /api/transactions/:id
DELETE /api/transactions/:id
POST   /api/transactions/bulk-delete
GET    /api/stats
GET    /api/settings
PUT    /api/settings
GET/POST/PUT/DELETE categories
GET/POST/PUT/DELETE payment-methods
GET/POST/PUT/DELETE accounts
GET/POST/DELETE favorites
GET/POST/PUT/DELETE rules
GET/POST/PUT/DELETE recurring
POST   /api/recurring/process
GET/PUT /api/pending
POST   /api/import
GET    /api/export
GET/POST /api/backup
POST   /api/restore
GET    /api/ai/status
POST   /api/ai/test
POST   /api/ai/parse
```

`GET /api/bootstrap` returns only startup metadata needed by the UI: app/mode/schema version, settings, categories, payment methods and accounts. It replaces four startup requests with one.

Mutation requests from browsers must be same-origin. `X-Local-Date: YYYY-MM-DD` may be supplied so local "today" behavior does not depend on container timezone.

## Finance

```text
GET    /api/income?month=YYYY-MM
POST   /api/income
PUT    /api/income/:id
DELETE /api/income/:id

GET    /api/budget?month=YYYY-MM
PUT    /api/budget
```

`GET /api/stats` returns expense/income totals, budget/savings/free-to-spend calculations, recurring commitments, projected month-end spending, six-month cash flow and category/payment/daily chart data.
